import { genVar } from "./var-counter.ts";
import { emitStringFromTree, exprNodeContainsMemberAccess } from "../expression-parser.ts";
// F8 / v0.6 — dual-mode meta-block kind test (live `"meta"` / native `"Meta"`).
import { isMetaKind } from "../types/ast.ts";
import { escapeHtmlAttr, VOID_ELEMENTS, HTML_BOOLEAN_ATTRS } from "./utils.ts";
import { isUserComponentMarkup } from "../component-expander.ts";
import { validateEmittedArtifact } from "./validate-emit.ts";
import { emitExprField } from "./emit-expr.ts";
import { extractReactiveDeps, collectReactiveVarNames, extractReactiveDepsTransitive, buildFunctionBodyRegistry, collectRequestIds } from "./reactive-deps.ts";
import { hasTemplateInterpolation } from "./rewrite.js";
import { isRcdataElement, isHtmlElement } from "../html-elements.js";
import { CGError } from "./errors.ts";
import * as acorn from "acorn";
import type { BindingRegistry } from "./binding-registry.ts";
import type { CompileContext } from "./context.ts";
import { isFlatDeclarationBlock, renderFlatDeclarationAsInlineStyle } from "./emit-css.ts";
import type { LowerCtx } from "./emit-css.ts";
// §65.3.2 / §65.4 (Task 2 [86]) — the `<theme>` token names + declared cell
// names for the flat-inline `#{}` `@`-sigil lowering (`@brand` → `var(--brand)`).
import { collectThemeContext, collectThemeTokenNames } from "./emit-theme-reset.ts";
// SPEC §6.4 / §5.4.1 / L17 — A1c C3 render-by-tag expansion. lookupStateCell resolves
// `<userName/>` to its decl record; getCellKind surfaces B5's `_cellKind` annotation
// (`"bindable"` for Shape 2 with bindable RHS — the only legal use kind that survives
// B6's diagnostic walker).
import { lookupStateCell, lookupQualifiedStateCell, lookupCompoundMembersByLeafName, getCellKind } from "../symbol-table.ts";
// A1c C16 — §53.7.1 HTML attr generation for refinement-typed bindable cells.
// `parsePredicateAnnotation` extracts the predicate from a typeAnnotation string;
// `deriveHtmlAttrs` maps the predicate to native HTML validation attributes.
import { parsePredicateAnnotation, deriveHtmlAttrs } from "./emit-predicates.ts";
// A1c C16 — `buildReactiveTypeMap` walks the file AST for `state-decl` typeAnnotations
// keyed by var-name (mirrors emit-bindings.ts §53.7.2 path for runtime gating).
import { buildReactiveTypeMap, lowerClassDirectiveCondition, lowerAttrTemplateValue } from "./emit-bindings.ts";
// errorBoundary (SPEC §19.6 + §19.6.8) — markup-context error catch support.
// `collectEnumRenders` builds the file's variant -> renders-markup map;
// `compileBoundaryMarkup` + `emitBoundaryMarkupExpr` lower fallback / renders
// markup to a runtime HTML expression. emit-event-wiring.ts consumes the
// boundary fields these stamp onto each logic binding.
import { collectEnumRenders, compileBoundaryMarkup, emitBoundaryMarkupExpr } from "./emit-error-boundary.ts";

// Supported bind: attribute names per SPEC §5.4
const SUPPORTED_BIND_NAMES = new Set(["value", "valueAsNumber", "checked", "selected", "files", "group"]);

// Supported transition types for transition:, in:, out: directives
const SUPPORTED_TRANSITIONS = new Set(["fade", "slide", "fly"]);

// S105 B1 — HTML Boolean attributes that admit reactive `${expr}` values.
// When present on a markup element with kind:"expr" value, the codegen path
// at this file emits a `data-scrml-bind-bool-<name>="<placeholderId>"`
// placeholder + registers a logic binding. The runtime emit at
// emit-event-wiring.ts wires an `_scrml_effect` that toggles attribute
// presence (setAttribute on truthy / removeAttribute on falsy).
//
// Initial v0.3 catalog: the 3 form-control bool attrs that frequently want
// reactive control. Extend in v0.4+ as adopter need surfaces (candidates:
// `hidden`, `multiple`, `open`, `checked`, `selected` — last two already
// have `bind:checked` / `bind:selected` paths; reactive-expr admission
// would require dispatch-precedence design).
const REACTIVE_BOOL_ATTRS = new Set(["disabled", "readonly", "required"]);

// S105 B1 / i29-D — shared emission for a reactive Boolean HTML attribute
// (`disabled` / `readonly` / `required`). BOTH value forms route here so they
// emit an IDENTICAL `data-scrml-bind-bool-<name>` placeholder + logic binding
// (which emit-event-wiring wires to an `_scrml_effect` toggling attribute
// presence via setAttribute("")/removeAttribute):
//   - the `expr` form   — `disabled=!@x`, `disabled=(expr)`  (source: exprNode)
//   - the bare-ref form — `disabled=@saving`                 (source: raw string)
// i29-D: the bare-`@var` form previously fell through to the general
// variable-ref `else`, emitting a STATIC `disabled="saving"` (always-on, no
// reactivity). Factoring keeps the two call sites in lockstep so they cannot
// drift. `exprNode` is optional: when absent, emit-event-wiring's
// `emitExprField` lowers `rawExpr` (e.g. `@saving`) via rewriteExprWithDerived.
function emitReactiveBoolAttr(
  name: string,
  parts: string[],
  registry: BindingRegistry | null | undefined,
  source: { rawExpr: string; exprNode?: unknown; refs?: string[] },
): void {
  const placeholderId = genVar(`attr_${name}`);
  parts.push(` data-scrml-bind-bool-${name}="${placeholderId}"`);
  if (registry) {
    registry.addLogicBinding({
      placeholderId,
      expr: source.rawExpr,
      isReactiveBoolAttr: true,
      boolAttrName: name,
      condExpr: source.rawExpr,
      condExprNode: source.exprNode,
      refs: source.refs,
    });
  }
}

// i81 — form controls whose live state lives in the `value` PROPERTY, not the
// `value` attribute. `setAttribute("value", …)` writes the DEFAULT value, which
// the browser ignores once the control is dirty (the user has typed), so a
// reactive `value=` would silently stop applying. See emitValueAttrApply.
const FORM_VALUE_ELEMENTS = new Set(["input", "textarea", "select"]);

// i81 — directives that own an element's inline `style`. `if=`/`show=` write
// `el.style.display`; `transition:`/`in:`/`out:` animate `opacity`. A reactive
// `style=` on the SAME element does `setAttribute("style", …)`, which replaces
// the WHOLE attribute and destroys whatever they wrote.
const STYLE_OWNING_DIRECTIVES = ["if", "show"];

/**
 * i81 (S239 finding 8) — is this ELEMENT one whose attributes are real DOM
 * attributes? Fail-CLOSED: only a positively-identified HTML element qualifies.
 *
 * The markup attribute namespace is shared by three things that all reach the
 * value-attr emitter, and only the first is a DOM attribute:
 *   a. real HTML attrs           `<div class=(@m)>`
 *   b. scrml DIRECTIVE attrs     `<tableFor pick=[...]>`  (a compiler construct)
 *   c. component call-site props `<List row={...}/>`      (see isDeclaredPropAttr)
 *
 * `resolvedKind` is the NR-authoritative routing signal (NR stamps it at Stage
 * 3.05; downstream stages read it — the legacy component boolean is a derived
 * backcompat field and routing on it is asserted against by the P3-FOLLOW test).
 * So an NR-stamped node is answered by NR: "html-builtin" and nothing else.
 *
 * WHY `null` NEEDS A SEPARATE ANSWER — and why the first cut's rationale was
 * WRONG. That cut admitted `resolvedKind == null` on the claim that "a <match>
 * arm body is not NR-stamped". FALSE: name-resolver.ts:365-369 explicitly
 * recurses into `anyN.arms` and walks `arm.body`. The measurement (arm-body
 * nodes arrive here with resolvedKind === undefined) was nonetheless correct —
 * the EXPLANATION was wrong, and an unexplained fail-open is a latent hole.
 *
 * The real source: emit-match.ts (~545) RE-PARSES each arm's `bodyRaw` through
 * the BS+TAB pipeline as a synthetic fragment AT CODEGEN TIME. NR ran long
 * before (Stage 3.05), so those fresh nodes were never stamped. The `null`
 * population is therefore "markup synthesized AFTER name resolution" — arm
 * bodies today, and anything a future stage synthesizes.
 *
 * That hole was REAL, not theoretical: `<tableFor pick=[...]>` inside a match arm
 * arrives with resolvedKind === undefined and emitted 2 bogus
 * `data-scrml-bind-attr-pick` DOM bindings under the first cut.
 *
 * So for the post-NR population we fall back to the SYNTACTIC question NR would
 * have answered — `isHtmlElement`, the compiler's own element registry
 * (`rendersToDom`). It answers true for div/span/button/svg/g/path and false for
 * tableFor/formFor/each/match. A dynamic `class=` inside a `<match>` arm is
 * idiomatic and keeps working; a directive element inside one is refused.
 */
function valueAttrElementIsLowerable(node: any, tag: string): boolean {
  if (node?.resolvedKind === "html-builtin") return true;
  // Post-NR synthesized markup (re-parsed <match> arm bodies): NR never saw it,
  // so ask the element registry directly. Fails closed on an unknown tag.
  if (node?.resolvedKind == null) return isHtmlElement(tag);
  return false;
}

/**
 * i81 (S239 finding 7) — is `name` a COMPONENT CALL-SITE PROP on this node?
 *
 * Component expansion runs BEFORE codegen and merges the call site's props onto
 * the component's ROOT element, so by the time emit-html sees the node its tag is
 * the definition's root element (`div`), not `List`, and its `attrs` are a MERGE
 * of the definition's own attributes and the caller's props. The two must be
 * treated oppositely:
 *
 *   <List row={ (item) => <span>…</span> }/>   ← a §14.9 parametric-snippet PROP.
 *       A compiler construct, consumed by the snippet machinery. Lowering it
 *       produced `const _scrml_v = ((item) => <span>…` — markup spliced into JS
 *       ⇒ E-CODEGEN-INVALID-LOGIC.
 *   const Card = <div class=(@theme)>…        ← the component's OWN root attr.
 *       An ordinary reactive value attribute that SHOULD lower.
 *
 * The first cut refused on `_expandedFrom != null`, i.e. EVERY attribute of every
 * expanded root — which left issue #81 unfixed for the whole class of user
 * components (S239 finding 7). The expander now stamps `_componentPropNames`
 * (its `def.propsDecl`), which is the precise discriminator: a DECLARED prop is a
 * construct; anything else on the root is markup.
 *
 * Fails CLOSED when the stamp is absent on an expanded root (older/secondary
 * expansion paths): refuse, keeping the pre-i81 drop rather than risking a
 * miscompile.
 */
function isDeclaredPropAttr(node: any, name: string): boolean {
  if (node?._expandedFrom == null) return false;
  const declared = node._componentPropNames;
  if (!Array.isArray(declared)) return true;
  return declared.includes(name);
}

// i81 (S268 fix-round finding 1) — JS globals that legitimately appear as free
// identifiers in a LOWERED value-attr expression. A reactive `@`-ref lowers to
// `_scrml_reactive_get("x")` (its only free identifier is the `_scrml_`-prefixed
// runtime helper), so a lowered expression whose free identifiers are all either
// `_scrml_`-prefixed or in this set is self-contained. Anything else is a token
// that will be UNDEFINED at runtime — see loweredExprHasFreeIdentifier.
const VALUE_ATTR_SAFE_GLOBALS = new Set<string>([
  "String", "Number", "Boolean", "Array", "Object", "JSON", "Math", "Date",
  "RegExp", "Map", "Set", "WeakMap", "WeakSet", "Promise", "Symbol", "BigInt",
  "parseInt", "parseFloat", "isNaN", "isFinite", "NaN", "Infinity", "undefined",
  "globalThis", "window", "document", "console", "Error",
  "encodeURIComponent", "decodeURIComponent",
]);

/**
 * i81 (S268 fix-round finding 1) — does a LOWERED value-attr expression reference
 * a FREE identifier that will be undefined at runtime?
 *
 * THE CRASH: a STRING prop on a component root (`const Badge = <span
 * title=(label) props={label:string}>`, `<Badge label="hi"/>`) is substituted by
 * the expander into the root's own value-attr expression as a BARE token — the
 * value `hi`, not the string literal `"hi"`. `title=(label)` lowers to
 * `const _scrml_v = ((hi));`, where `hi` is a free, undeclared identifier. That
 * throws `ReferenceError` at DOMContentLoaded INSIDE the shared wiring handler,
 * so every UNRELATED binding after it on the page never wires — a whole-page
 * crash, strictly worse than the pre-#81 silent drop. It slips both the Acorn
 * PARSE gate (F2) and R26, because `((hi))` is syntactically valid — only
 * EXECUTION (or a scope walk) catches the free reference.
 *
 * This is an Acorn SCOPE WALK, not a regex (a free reference is a scoping
 * property). A reactive `@`-ref lowers to `_scrml_reactive_get("x")` whose only
 * free identifier is `_scrml_`-prefixed; a self-contained expression's free
 * identifiers are therefore all `_scrml_`-prefixed or JS globals. Any OTHER free
 * identifier is a substituted-prop token (or similar) that crashes at runtime.
 *
 * Gated by the caller to `_expandedFrom` component roots (the only place the
 * expander substitutes props into a root's own attributes), so it never
 * false-refuses a top-level value-attr whose bare identifier is a server-fn name
 * awaiting the whole-buffer post-mangle pass.
 */
function loweredExprHasFreeIdentifier(lowered: string): boolean {
  let ast: acorn.Node;
  try {
    ast = acorn.parse(`const _scrml_probe = (${lowered});`, { ecmaVersion: 2022, sourceType: "module" });
  } catch {
    // Unparseable is the F2 probe's concern (it runs first); not ours.
    return false;
  }
  let found = false;
  const walk = (node: any, bound: Set<string>): void => {
    if (found || !node || typeof node.type !== "string") return;
    let scope = bound;
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression"
    ) {
      const names: string[] = [];
      const collect = (p: any) => {
        if (!p) return;
        if (p.type === "Identifier") names.push(p.name);
        else if (p.type === "AssignmentPattern") collect(p.left);
        else if (p.type === "RestElement") collect(p.argument);
        else if (p.type === "ArrayPattern") (p.elements ?? []).forEach(collect);
        else if (p.type === "ObjectPattern") (p.properties ?? []).forEach((pr: any) => collect(pr.value ?? pr.argument));
      };
      (node.params ?? []).forEach(collect);
      if (node.id?.name) names.push(node.id.name);
      scope = new Set([...bound, ...names]);
    }
    if (node.type === "VariableDeclarator" && node.id?.type === "Identifier") {
      bound.add(node.id.name);
    }
    if (node.type === "Identifier") {
      const n = node.name;
      if (!scope.has(n) && !n.startsWith("_scrml_") && !VALUE_ATTR_SAFE_GLOBALS.has(n)) {
        found = true;
        return;
      }
    }
    for (const key of Object.keys(node)) {
      if (key === "type" || key === "start" || key === "end" || key === "loc") continue;
      // Non-reference identifier positions: an object-property KEY and a
      // non-computed member `.property` are NAMES, not reads of a binding.
      if (key === "key" && node.type === "Property" && !node.computed) continue;
      if (key === "property" && node.type === "MemberExpression" && !node.computed) continue;
      const child = (node as any)[key];
      if (Array.isArray(child)) for (const c of child) walk(c, scope);
      else if (child && typeof child.type === "string") walk(child, scope);
    }
  };
  walk(ast, new Set<string>());
  return found;
}

/**
 * i81 (S239 finding 2) — CODEGEN-CAPABILITY gate. Can this reactive VALUE
 * attribute's expression be lowered to VALID JavaScript? Returns false (with a
 * diagnostic) for shapes we cannot lower faithfully, so the attribute keeps its
 * pre-i81 behavior (dropped) instead of becoming a MISCOMPILE. A dropped
 * attribute is a bug; invalid JS is worse — it takes the whole page down.
 *
 * This is ORTHOGONAL to Axiom ① writer-ownership (`analyzeWriterConflict`): this
 * asks "can the compiler lower it at all", the ① analysis asks "is it the sole
 * writer of its DOM surface". The lowerability gate runs FIRST — an expression
 * that cannot be lowered is dropped regardless of any surface conflict.
 *
 * Refusing HERE means no placeholder and no binding are produced at all, so the
 * emitted HTML stays byte-identical to pre-i81 and the wiring emitters can never
 * disagree with the markup.
 */
function valueAttrIsLowerable(
  val: any,
  name: string,
  attrs: any[],
  tag: string,
  attr: any,
  node: any,
  errors: any[] | null | undefined,
): boolean {
  // --- (2) the expression must lower to VALID JavaScript -------------------
  // `emitExprField` emits a template literal verbatim (the expression parser
  // classifies it as a `lit`), so `class=(`btn ${@variant}`)` lowers with a RAW
  // `@` — invalid JS. Pre-i81 the attr was dropped and the bundle stayed valid;
  // with the emitter live, the whole COMPILE now aborts on
  // E-CODEGEN-INVALID-LOGIC ("compiler defect, please report it") for an
  // IDIOMATIC shape. So this is not merely "don't emit bad JS" — without this
  // check the diff breaks adopter builds that compiled clean before.
  //
  // Checked with the repo's own acorn helper (`isSingleJsExpression`), the exact
  // parser the S141 emitted-JS gate uses, so the two cannot disagree. Rewriting
  // `@` inside template literals belongs in `emitExprField`/`rewriteExpr` and
  // would change every lowering path in the compiler — a separate arc.
  const lowered = emitExprField(val.exprNode, val.raw, { mode: "client" });
  // Validate the EXACT statement shape the wiring emitters produce, with the
  // very parser + options the S141 emitted-JS gate uses, so this check and that
  // gate can never disagree. (Note: `isSingleJsExpression` is NOT usable here —
  // acorn's `parseExpressionAt("(cls)")` returns the INNER node, whose `end`
  // stops before the closing paren, so it reports every parenthesized
  // expression as invalid. `val.raw` is always parenthesized.)
  const _probe = validateEmittedArtifact({
    sourceFile: "",
    artifact: "value-attr-probe.js",
    contents: `const _scrml_v = (${lowered});`,
  });
  if (_probe !== null) {
    if (errors) {
      errors.push(new CGError(
        "W-CG-VALUE-ATTR-UNLOWERABLE",
        `W-CG-VALUE-ATTR-UNLOWERABLE: the reactive value attribute \`${name}=\` on ` +
        `<${tag}> could not be lowered to valid JavaScript, so it is NOT emitted and ` +
        `the attribute will be absent at runtime.\n` +
        `  Expression: ${String(val.raw ?? "").slice(0, 80)}\n\n` +
        `  The usual cause is a template literal that interpolates a reactive cell — ` +
        `\`${name}=(\`… \${@cell} …\`)\`. The expression parser treats a template literal ` +
        `as an opaque literal, so the \`@cell\` reference is not rewritten.\n` +
        `  Workaround: use string concatenation instead — ` +
        `\`${name}=("…" + @cell + "…")\` — which lowers correctly.`,
        attr?.span ?? node?.span ?? { file: "", start: 0, end: 0, line: 0, col: 0 },
        "warning",
      ));
    }
    return false;
  }

  // NOTE — the `style=` vs `if=`/`show=`/`transition:` clobber (S239 finding 3,
  // formerly a `W-CG-VALUE-ATTR-STYLE-CONFLICT` warn+drop here) is NO LONGER a
  // lowerability concern. Under Axiom ① it is a DOM-surface WRITER conflict,
  // handled uniformly by `analyzeWriterConflict` (which promotes it to the
  // `E-ATTR-WRITER-CONFLICT` compile error naming both sites). `attrs`/`tag`
  // remain in the signature for parity with the surface-scan call site.

  // --- (4) component-root prop-substitution crash (S268 fix-round finding 1) ---
  // On an `_expandedFrom` component root, the expander substitutes a STRING prop
  // into the root's own value-attr expression as a BARE token: `title=(label)` on
  // `<Badge label="hi"/>` lowers to `((hi))` — a FREE identifier that throws a
  // ReferenceError at DOMContentLoaded INSIDE the shared wiring handler, killing
  // EVERY unrelated binding on the page. Pre-#81 the attr was silently dropped
  // (no crash); emitting it turned a missing attribute into a dead page. FAIL
  // CLOSED: if the lowered expression on such a root references a free identifier
  // (not `_scrml_`-prefixed, not a JS global — i.e. not a self-contained reactive
  // lowering), drop the attribute, restoring the pre-#81 no-crash behavior. Gated
  // to `_expandedFrom` roots so a top-level value-attr whose bare identifier is a
  // server-fn name awaiting the post-mangle pass is never false-refused.
  if (node?._expandedFrom != null && loweredExprHasFreeIdentifier(lowered)) {
    if (errors) {
      errors.push(new CGError(
        "W-CG-VALUE-ATTR-COMPONENT-PROP",
        `W-CG-VALUE-ATTR-COMPONENT-PROP: the reactive value attribute \`${name}=\` on ` +
        `the root of component <${node._expandedFrom}> references a value that is not a ` +
        `reactive cell, so it cannot be lowered safely and is NOT emitted (the ` +
        `attribute is absent at runtime).\n` +
        `  Expression: ${String(val.raw ?? "").slice(0, 80)}\n\n` +
        `  The usual cause is a STRING prop used in an expression on the component's ` +
        `root element (\`<${node._expandedFrom} ${name}=(<prop>) …>\`): the prop is ` +
        `substituted by value as a bare token, which is undefined at runtime. Reference ` +
        `a reactive cell (\`@cell\`) instead, or move the attribute onto a child element ` +
        `of the component body.`,
        attr?.span ?? node?.span ?? { file: "", start: 0, end: 0, line: 0, col: 0 },
        "warning",
      ));
    }
    return false;
  }

  return true;
}

// i81 Axiom ① — attribute-name prefixes for the per-token / per-property
// COMPOSERS that RMW a single slice of a shared surface. A wholesale value
// writer cannot coexist with any of these on the same physical surface.
const TRANSITION_ATTR_PREFIXES = ["transition:", "in:", "out:"];

/**
 * i81 Axiom ① — DOM-surface writer-ownership conflict analysis.
 *
 * A reactive value attribute (`class=(expr)`, `style=(expr)`, `value=(expr)`,
 * `title=`, `data-*`, …) is a WHOLESALE writer of its physical DOM surface: it
 * replaces the ENTIRE className / the ENTIRE style attribute / the `.value`
 * property / the whole attribute on every reactive update. Per Axiom ①
 * (exclusive wholesale-owner — bryan's #81 ruling, SPEC §5.5.3/§5.5.4) a
 * wholesale writer must be the SOLE writer of its surface. A second writer on
 * the same surface would have its work silently erased on the next wholesale
 * write:
 *   - className ← `class:name=` (classList.toggle, per-token composer),
 *                 `transition:`/`in:`/`out:` (transition classes)
 *   - style     ← `if=`/`show=` (`el.style.display`, per-property composer),
 *                 `transition:`/`in:`/`out:` (`opacity`)
 *   - `.value`  ← `bind:value` (property + writeback, on a form control)
 * A generic string attribute (`title`, `id`, `alt`, `data-*`) has no composer
 * form, so it is always a sole writer of its own surface.
 *
 * Returns null when this attribute is the sole writer of its surface (→ EMIT the
 * binding, the #81 fix), or a descriptor naming the competing writer(s) when it
 * is not (→ `E-ATTR-WRITER-CONFLICT`, the author picks one owner).
 *
 * Self-exclusion is automatic: the scan matches only COMPOSER names, never the
 * wholesale owner's own name, so the emitted attribute never matches itself.
 *
 * Two wholesale owners of one surface (e.g. `<div class=(@a) class=(@b)>`) are
 * NOT flagged: they emit two independent reactive `class` bindings with no error
 * — benign at runtime (the HTML parser keeps the first `class` attribute; the
 * second binding's querySelector finds nothing and its effect is a null-guarded
 * no-op), so it is a latent author mistake rather than a crash. Detecting it
 * would require counting same-named wholesale attrs across the per-attr emit
 * loop and risks a double-fire; left as a known gap (docs/known-gaps.md).
 */
function analyzeWriterConflict(
  attrs: any[],
  name: string,
  tag: string,
): { surface: string; competitors: string[] } | null {
  const otherNames = (attrs || [])
    .filter((a: any) => a && typeof a.name === "string")
    .map((a: any) => a.name as string);
  const isTransition = (n: string) =>
    TRANSITION_ATTR_PREFIXES.some((p) => n.startsWith(p));

  let surface: string | null = null;
  let competitors: string[] = [];

  if (name === "class") {
    surface = "class";
    competitors = otherNames.filter(
      (n) => n.startsWith("class:") || isTransition(n),
    );
  } else if (name === "style") {
    surface = "style";
    competitors = otherNames.filter(
      (n) => STYLE_OWNING_DIRECTIVES.includes(n) || isTransition(n),
    );
  } else if (name === "value" && FORM_VALUE_ELEMENTS.has(tag)) {
    surface = "value";
    competitors = otherNames.filter((n) => n === "bind:value");
  } else {
    // Generic string attribute (title/id/alt/data-*/…): its own surface, no
    // composer form → always a sole writer.
    return null;
  }

  // Dedupe while preserving order (a surface may carry several composers).
  const seen = new Set<string>();
  competitors = competitors.filter((n) => (seen.has(n) ? false : (seen.add(n), true)));
  if (competitors.length === 0) return null;
  return { surface, competitors };
}

// Element-type restrictions per SPEC §5.4
const BIND_VALID_TAGS: Record<string, Set<string>> = {
  "bind:value":          new Set(["input", "textarea", "select"]),
  "bind:valueAsNumber":  new Set(["input", "textarea", "select"]),
  "bind:checked":        new Set(["input"]),
  "bind:selected":       new Set(["select"]),
  "bind:files":          new Set(["input"]),
  "bind:group":          new Set(["input"]),
};

// Lifecycle elements that emit no HTML — handled by emit-reactive-wiring.js
const LIFECYCLE_SILENT_TAGS = new Set(["timer", "poll"]);

// ss15 item-2 (S214, 2026-06-22) -- SPEC section 40.8 default-logic-mode parent tags.
// Per SPEC.md:10347 (normative): "the section-40.8 default-logic auto-lift
// fires only at `<program>`/`<page>`/`<channel>` direct-child roots, never
// inside nested markup." A bare expression in such a default-logic body is an
// EFFECT at initial mount (SPEC sections 17.3 + 6.7.1a) -- it executes once; it
// does NOT render its return as a text node. So the logic-node markup-walker
// MUST NOT allocate a `<span data-scrml-logic>` render slot or an
// addLogicBinding for a logic node whose enclosing markup parent is one of
// these (or for a logic node at the file top-level, which is likewise a
// default-logic root). A `${...}` interpolation nested inside ANY OTHER markup
// element (`<div>`, `<span>`, a component root, etc.) is a markup-interpolation
// that DOES render -- unchanged.
//
// Closes g-on-mount-bare-call-render-slot: `on mount { val() }` (which desugars
// to a bare-expr at the program-body, ast-builder.js:8573/11968) and a bare
// program-body `${ val() }` previously each emitted a spurious render slot
// printing the call return ("[object Promise]" for async fns) at page top.
const DEFAULT_LOGIC_MODE_TAGS = new Set(["program", "page", "channel"]);

// R25-Bug-41 (S138, 2026-05-27) — Server-side-only state-block types whose body
// content MUST NOT appear in the HTML render-tree. `<schema>` (SPEC §39) and
// `<seeds>` (per block-splitter `COMPOUND_LIFT_EXEMPT_TAGS` document-root list)
// produce DDL / seed-data artifacts via dedicated compiler passes (schemaFor
// walker, migration diff, seed runner). Their raw body text is NOT HTML and
// MUST be suppressed at the markup-walker. Without this guard the state-kind
// branch in `emitNode` walks raw text children into the HTML body — the R25
// dev-2-elixir reproducer dumped `cards { id integer primary key, title text
// not null }` as visible prose in the rendered page.
//
// `<db>` / `<engine>` / `<machine>` are NOT in this set:
//   * `<db>` bodies are canonically `${ ... }` logic contexts (declarations
//     only — no DOM emission from the markup-walker).
//   * `<engine>` / `<machine>` route upstream to `engine-decl` AST shape
//     (handled at emit-html.ts:1830) before the state-kind branch sees them.
const SERVER_ONLY_STATE_TYPES = new Set(["schema", "seeds"]);

/**
 * Phase 2b of if/show split: detect whether an if= element's subtree is
 * "clean" — i.e., contains no nested wiring (no events, no reactive
 * interpolation, no nested if=/show=, no components, no state openers,
 * no expression attributes). Clean subtrees route through mount/unmount
 * (template-clone + marker comment + scope teardown). Non-clean subtrees
 * fall back to the display-toggle path (Phase 1) until later sub-phases
 * extend mount/unmount to cover those cases.
 *
 * Conservative: when in doubt, return false (display-toggle is the safe
 * fallback that already works).
 */
/**
 * Bug 5 Phase 2 (S107, 2026-05-19) — Anomaly C classifier.
 *
 * Checks whether a logic-body child contributes "renderable content" to its
 * markup-walk position. Renderable = needs a DOM anchor. Two kinds qualify:
 *   - `bare-expr` — interpolation value consumed by binding-wiring textContent
 *     write at DOMContentLoaded
 *   - `lift-expr` — DOM positioning target consumed by lift-target wiring
 *
 * Declarations (const/let/function/type) and statement constructs (if/for/while)
 * are renderable only if they CONTAIN a bare-expr or lift-expr (recursive).
 *
 * Used at the `node.kind === "logic"` branch to skip placeholder allocation
 * for declaration-only bodies — closes the phantom `<span data-scrml-logic>`
 * anomaly visible on `<program>`-body bare `const VERSION = "v0.3.0"` shapes.
 *
 * Mirror of `stmtContainsLift` at emit-reactive-wiring.ts:174 with the
 * `bare-expr` shortcut added. Kept inline (not imported) to avoid the
 * codegen circular-import surface.
 */
function stmtContainsRenderableLogic(node: any): boolean {
  if (!node || typeof node !== "object") return false;
  if (node.kind === "bare-expr" || node.kind === "lift-expr") return true;
  for (const key of ["body", "consequent", "alternate"]) {
    if (Array.isArray(node[key])) {
      for (const child of node[key]) {
        if (stmtContainsRenderableLogic(child)) return true;
      }
    }
  }
  return false;
}

/**
 * ss15 item-2 (S214) — lift-only recursive classifier (a narrowing of
 * stmtContainsRenderableLogic that excludes the bare-expr shortcut).
 *
 * A `lift-expr` is a DOM-positioning target consumed by lift-target wiring
 * (e.g. a `${ for (...) { lift <li/> } }` block). Unlike a bare-expr (which
 * RENDERS its return as a text node only in a markup-interpolation position),
 * a lift-expr emits a positioned DOM subtree and is legitimate in ANY context
 * — INCLUDING a §40.8 default-logic body (`<program>`-body iteration is the
 * canonical Tier-0 `${ for/lift }` form, §17.4). So the default-logic-mode
 * guard MUST NOT suppress a logic node that contains a lift-expr; it only
 * suppresses the spurious bare-expr render slot. This helper lets the guard
 * distinguish "purely bare-expr renderable" (suppress) from "contains lift"
 * (keep the placeholder + lift wiring).
 */
function stmtContainsLiftExpr(node: any): boolean {
  if (!node || typeof node !== "object") return false;
  if (node.kind === "lift-expr") return true;
  for (const key of ["body", "consequent", "alternate"]) {
    if (Array.isArray(node[key])) {
      for (const child of node[key]) {
        if (stmtContainsLiftExpr(child)) return true;
      }
    }
  }
  return false;
}

/**
 * inline-value-form-interp (§18.0 / §17.6) — VALUE-FORM CONTROL-FLOW classifier.
 *
 * True when `node` is a value-PRODUCING control-flow statement that, as the SOLE
 * content of a markup `${...}` interpolation, must render its selected value
 * (and reactively update) — the inline analogue of the derived-cell twin
 * (`const <d> = match …; ${@d}`):
 *
 *   - a JS-style `match expr { .A :> v … }` whose every arm is an inline VALUE
 *     arm (`match-arm-inline`). Block-bodied arms (`.V => { … }`) don't reliably
 *     produce a value through the value-IIFE and are left to the prior path.
 *   - an `if cond { a } else { b }` cascade whose every branch is exactly one
 *     value-producing `bare-expr` (`else if` chains allowed; an `else` is
 *     required — a value-form `if` must yield a value on every path).
 *
 * This is a PURE shape check (no codegen): it is the HTML-pass gate that decides
 * whether to allocate the render slot, and it is kept in lock-step with the
 * client-JS-pass value emitters (emit-control-flow.ts: `emitMatchExpr` /
 * `emitIfValueExpr`) which are total for exactly these shapes — so a slot is
 * never allocated for a body the value emitter can't render.
 */
function isValueFormControlFlowStmt(node: any): boolean {
  if (!node || typeof node !== "object") return false;
  if (node.kind === "match-stmt") {
    const arms: any[] = Array.isArray(node.body) ? node.body : [];
    if (arms.length === 0) return false;
    return arms.every((a) => a && a.kind === "match-arm-inline");
  }
  if (node.kind === "if-stmt") return isValueFormIfStmt(node);
  return false;
}

function isValueFormIfStmt(node: any): boolean {
  if (!node || node.kind !== "if-stmt") return false;
  if (!isSoleBareExprBranch(node.consequent ?? node.body ?? null)) return false;
  const alt = node.alternate;
  if (!alt) return false; // value-form requires an else
  const altArr: any[] = Array.isArray(alt) ? alt : [alt];
  if (altArr.length === 1 && altArr[0] && altArr[0].kind === "if-stmt") {
    return isValueFormIfStmt(altArr[0]); // else-if chain
  }
  return isSoleBareExprBranch(altArr);
}

function isSoleBareExprBranch(stmts: any): boolean {
  return Array.isArray(stmts) && stmts.length === 1 && !!stmts[0] && stmts[0].kind === "bare-expr";
}

function isCleanIfSubtree(children: any[]): boolean {
  for (const child of children ?? []) {
    if (!isCleanIfNode(child)) return false;
  }
  return true;
}

/**
 * Returns true if an attribute is "wiring-free" — does not require any
 * compile-time-emitted runtime wiring (event listeners, reactive
 * subscriptions, two-way bindings, conditional classes, transitions,
 * directive semantics). Static HTML attributes pass; reactive or
 * directive-style attributes do not.
 *
 * The optional `allowName` parameter lets the caller exempt one attribute
 * (typically the if= attribute on the element under consideration).
 */
function attrIsWiringFree(attr: any, allowName: string | null = null): boolean {
  const name: string = attr.name ?? "";
  if (name === allowName) return true;
  if (name === "if" || name === "show" || name === "else" || name === "else-if") return false;
  if (name === "protect" || name === "auth" || name === "slot") return false;
  if (name.startsWith("on")) return false;
  if (name.startsWith("bind:")) return false;
  if (name.startsWith("class:")) return false;
  if (name.startsWith("transition:") || name.startsWith("in:") || name.startsWith("out:")) return false;
  const val = attr.value;
  if (val) {
    if (val.kind === "variable-ref" && (val.name ?? "").startsWith("@")) return false;
    if (val.kind === "expr") return false;
    if (val.kind === "string-literal" && hasTemplateInterpolation(val.value)) return false;
  }
  return true;
}

function isCleanIfNode(node: any): boolean {
  if (!node || typeof node !== "object") return true;
  if (node.kind === "text" || node.kind === "comment") return true;
  if (node.kind !== "markup") return false; // logic, expr, state, if-chain, meta = not clean

  const tag: string = node.tag ?? node.tagName ?? "";
  // Components (capital first letter) and language-level state openers
  // are not "clean" — they have their own wiring.
  if (/^[A-Z]/.test(tag)) return false;

  const attrs: any[] = node.attributes ?? node.attrs ?? [];
  for (const attr of attrs) {
    if (!attrIsWiringFree(attr)) return false;
  }

  const children: any[] = node.children ?? [];
  for (const child of children) {
    if (!isCleanIfNode(child)) return false;
  }
  return true;
}

/**
 * Strip if=/else-if=/else attributes from an if-chain branch element before
 * emitting. The chain wrapper (data-scrml-if-chain / data-scrml-chain-branch)
 * already drives visibility for the chain — the inner element's chain-construction
 * attribute is AST-level metadata and would (a) leak as a meaningless HTML attr
 * if not stripped and (b) post-Phase-2c trigger a duplicate mount/unmount
 * controller via emit-html's early-out gate. Returns a shallow-cloned node with
 * the chain attributes filtered out; original AST is not mutated.
 */
function stripChainBranchAttrs(node: any): any {
  if (!node || typeof node !== "object" || node.kind !== "markup") return node;
  const filtered = (node.attributes ?? node.attrs ?? []).filter(
    (a: any) => a && a.name !== "if" && a.name !== "else-if" && a.name !== "else",
  );
  return { ...node, attributes: filtered, attrs: filtered };
}

/**
 * Phase 2g: per-branch cleanliness check for if-chain branches.
 *
 * A chain branch element ALWAYS carries one of `if=` / `else-if=` / `else`
 * at the AST level (chain-construction metadata). Those three attributes
 * unconditionally fail `attrIsWiringFree`, so calling `isCleanIfNode` on
 * the raw branch would always return false. Apply the strip-precursor
 * conceptually here (without mutating the AST), then defer to the existing
 * `isCleanIfNode` predicate so cleanliness criteria match the single-`if=`
 * Phase 2c path verbatim.
 *
 * Returns true if the branch element compiles to clean HTML — lowercase tag,
 * no wiring-bearing attributes (after stripping if/else-if/else), and a
 * wholly-clean descendant tree per `isCleanIfSubtree`. Clean branches go
 * through the per-branch template+marker mount/unmount path. Dirty branches
 * stay inline-with-display-toggle wrapped in a per-branch wrapper inside the
 * chain wrapper (pre-Phase-2g shape, retained as the dirty-fallback shape).
 */
function isCleanChainBranch(branchElement: any): boolean {
  if (!branchElement || typeof branchElement !== "object") return true;
  if (branchElement.kind === "text" || branchElement.kind === "comment") return true;
  if (branchElement.kind !== "markup") return false;
  const stripped = stripChainBranchAttrs(branchElement);
  return isCleanIfNode(stripped);
}

// §35 Input state type elements that emit no HTML — handled by emit-reactive-wiring.js
const INPUT_STATE_TAGS = new Set(["keyboard", "mouse", "gamepad"]);

// §6.7.7 <request> — single-shot async fetch state type, emits no HTML
const REQUEST_TAGS = new Set(["request"]);

/**
 * §36 E-INPUT-005 — duplicate input-state-type id within the same scope.
 *
 * Walks the AST collecting (id, tag, scope) tuples across the three input
 * state tags (`<keyboard>`, `<mouse>`, `<gamepad>`). The three tags share a
 * single id namespace per SPEC §34 catalog line 14900 + §36.7 lines 15854-15871:
 * `<keyboard id="x"/>` + `<mouse id="x"/>` in the same scope is a duplicate.
 *
 * Scope semantics — per SPEC §36.5.1 (S89 OQ-B ratification): the
 * IMMEDIATELY ENCLOSING SCOPE owns the input-state lifecycle. Scope boundaries
 * are determined by §6.7.2: `<program>` (root permanent scope) plus any
 * element conditionally rendered (`if=`). Nested-scope declarations with the
 * same id are NOT duplicates — they live in disjoint mount/unmount windows.
 *
 * One-pass walker; per-scope `Map<id, …>` accumulator pushed/popped on
 * scope-boundary enter/exit. Fires E-INPUT-005 on the 2nd (and any subsequent)
 * occurrence of the same id within a single scope frame — mirrors the
 * per-occurrence emission pattern of E-INPUT-001..004 (one error per offending
 * declaration site).
 *
 * Independent of the main `emitNode` HTML emitter to keep concerns separated;
 * runs once at generateHtml entry over the same top-level nodes array.
 */
function checkInputStateDuplicateIds(nodes: any[], errors: CGError[]): void {
  // Stack of scope frames. Top frame is the "immediately enclosing scope".
  // Each frame maps `id` -> { tag, span } of the FIRST decl seen in that scope.
  const scopeStack: Map<string, { tag: string }>[] = [new Map()];

  function currentScope(): Map<string, { tag: string }> {
    return scopeStack[scopeStack.length - 1];
  }

  function extractIdAttr(attrs: any[]): string | null {
    const idAttr = (attrs ?? []).find((a: any) => a?.name === "id");
    if (!idAttr) return null;
    const v = idAttr.value;
    if (v?.kind === "string-literal") return typeof v.value === "string" ? v.value : null;
    if (v?.kind === "variable-ref") {
      const raw: string = (v.name ?? "").toString();
      return raw.replace(/^@/, "");
    }
    return null;
  }

  function walk(node: any): void {
    if (!node || typeof node !== "object") return;

    // Containers that hold children but are not themselves markup scope boundaries.
    if (node.kind === "logic" && Array.isArray(node.body)) {
      for (const c of node.body) walk(c);
      return;
    }
    if (node.kind === "state" && Array.isArray(node.children)) {
      for (const c of node.children) walk(c);
      return;
    }
    if (node.kind === "if-chain" && Array.isArray(node.branches)) {
      // Each branch element is its own scope (§17.1.1 + §6.7.2: if=/else-if=/else
      // are conditional renders, each creating an independent lifecycle scope).
      for (const br of node.branches) {
        scopeStack.push(new Map());
        walk(br?.element);
        scopeStack.pop();
      }
      return;
    }
    if (node.kind === "engine-decl" && Array.isArray(node.arms)) {
      // Each engine variant arm is its own mount-lifecycle scope (Phase A10).
      for (const arm of node.arms) {
        if (arm && Array.isArray(arm.body)) {
          scopeStack.push(new Map());
          for (const c of arm.body) walk(c);
          scopeStack.pop();
        }
      }
      return;
    }

    if (node.kind !== "markup") return;

    const tag: string = node.tag;
    const attrs: any[] = Array.isArray(node.attrs) ? node.attrs : (Array.isArray(node.attributes) ? node.attributes : []);
    const children: any[] = Array.isArray(node.children) ? node.children : [];

    // Per §6.7.2 + §36.5.1: scope boundaries are <program> (permanent root
    // scope) and any element with an if= attribute (conditional-render scope).
    const hasIfAttr = attrs.some((a: any) => a?.name === "if");
    const isScopeBoundary = tag === "program" || hasIfAttr;

    if (isScopeBoundary) scopeStack.push(new Map());

    // Duplicate-id check for input-state tags only.
    if (INPUT_STATE_TAGS.has(tag)) {
      const id = extractIdAttr(attrs);
      if (id) {
        const scope = currentScope();
        const existing = scope.get(id);
        if (existing) {
          const span = node.span ?? { file: "", start: 0, end: 0, line: 1, col: 1 };
          errors.push(new CGError(
            "E-INPUT-005",
            `E-INPUT-005: Duplicate input state id \`"${id}"\`. Each input state type ` +
            `(\`<keyboard>\`, \`<mouse>\`, \`<gamepad>\`) must have a unique id within its ` +
            `scope (first declared as \`<${existing.tag}>\`, this declaration is ` +
            `\`<${tag}>\`). Choose a different id for the second \`<${tag}>\`.`,
            span,
          ));
        } else {
          scope.set(id, { tag });
        }
      }
    }

    // Always recurse — including into <program name="..."> (worker bundle
    // bodies) because their input-state declarations still participate in
    // the runtime registry and warrant the same uniqueness guarantee within
    // their own scope. The emit-html walker short-circuits named programs
    // for HTML emission; that does not apply to this static check.
    for (const child of children) walk(child);

    if (isScopeBoundary) scopeStack.pop();
  }

  for (const n of nodes) walk(n);
}

// §6.7.8 <timeout> — single-shot timer state type, emits no HTML
const TIMEOUT_TAGS = new Set(["timeout"]);

/**
 * A1c C3 — Lower a state-cell's validators to HTML-native attributes for
 * carry-forward at the render-by-tag expansion site (SPEC §6.4.2 step 4 — "Any
 * validators declared on the cell are wired as HTML attributes and connected
 * to the validity surface (§6.11)"). C3 emits the HTML-native subset; the
 * validity-surface side is C7+.
 *
 * Only the validators with HTML-native semantics get lowered:
 *
 *   - `req` (bareword, no args)        → `required` (boolean attribute)
 *   - `pattern(re|"...")`              → `pattern="<source>"` (string)
 *   - `min(N)`                         → `min="N"`              (string)
 *   - `max(N)`                         → `max="N"`              (string)
 *   - `length(>=N)`                    → `minlength="N"`        (string)
 *   - `length(<=N)`                    → `maxlength="N"`        (string)
 *   - `length(=N)`                     → both `minlength` + `maxlength` set to N
 *
 * All other validators (`is some`, `gt`/`lt`/`gte`/`lte`/`eq`/`neq`/`oneOf`/`notIn`,
 * stdlib `email`/`url`/`numeric`/`integer`, `custom`) are NOT HTML-native — they
 * stay validity-surface-only (C7+).
 *
 * Returns an array of attribute objects matching the markup AST `attributes` shape
 * (`{name, value: {kind, value}}`). The caller appends these to the renderSpec
 * element's attribute list before re-emitting via `emitNode`.
 *
 * Tolerant by default: any unrecognised arg shape silently no-ops on that validator
 * (B9/B10 already enforced shape; defensive at codegen time).
 */
function _validatorAttrsForCell(declNode: any): Array<{ name: string; value: { kind: string; value: string } }> {
  const validators: any[] = (declNode?.validators as any[]) ?? [];
  if (!Array.isArray(validators) || validators.length === 0) return [];
  const out: Array<{ name: string; value: { kind: string; value: string } }> = [];
  for (const v of validators) {
    if (!v || typeof v !== "object") continue;
    const name: string = v.name ?? "";
    const args: any[] | null = v.args ?? null;

    // `req` — args === null (bareword) per B9 contract.
    if (name === "req" && args === null) {
      out.push({ name: "required", value: { kind: "string-literal", value: "" } });
      continue;
    }

    if (!Array.isArray(args) || args.length === 0) continue;

    const firstArg = args[0];

    if (name === "pattern") {
      // pattern(/regex/) → escape-hatch with raw text "/^.../" (B9 specifics).
      // pattern("regex") → ExprNode with litType:"string".
      let patternSrc: string | null = null;
      if (firstArg?.kind === "escape-hatch" && typeof firstArg.raw === "string") {
        // Strip leading/trailing `/` from regex literal raw form.
        const raw: string = firstArg.raw;
        const rxMatch = raw.match(/^\/(.*)\/[gimsuy]*$/);
        patternSrc = rxMatch ? rxMatch[1] : raw;
      } else if (firstArg?.kind === "lit" && firstArg.litType === "string" && typeof firstArg.value === "string") {
        patternSrc = firstArg.value;
      }
      if (patternSrc !== null) {
        out.push({ name: "pattern", value: { kind: "string-literal", value: patternSrc } });
      }
      continue;
    }

    if (name === "min" || name === "max") {
      let numStr: string | null = null;
      if (firstArg?.kind === "lit" && firstArg.litType === "number" && firstArg.value !== undefined) {
        numStr = String(firstArg.value);
      } else if (firstArg?.kind === "escape-hatch" && typeof firstArg.raw === "string") {
        // Defensive: numbers might land in escape-hatch in rare AST shapes.
        const trimmed = firstArg.raw.trim();
        if (/^-?\d+(\.\d+)?$/.test(trimmed)) numStr = trimmed;
      }
      if (numStr !== null) {
        out.push({ name, value: { kind: "string-literal", value: numStr } });
      }
      continue;
    }

    if (name === "length") {
      // RelationalPredicateNode (B9 sibling kind): {kind:"relational-predicate", op, value:ExprNode}
      if (firstArg?.kind === "relational-predicate") {
        const op: string = firstArg.op ?? "";
        const valExpr = firstArg.value;
        let numStr: string | null = null;
        if (valExpr?.kind === "lit" && valExpr.litType === "number" && valExpr.value !== undefined) {
          numStr = String(valExpr.value);
        }
        if (numStr === null) continue;
        if (op === ">=") {
          out.push({ name: "minlength", value: { kind: "string-literal", value: numStr } });
        } else if (op === "<=") {
          out.push({ name: "maxlength", value: { kind: "string-literal", value: numStr } });
        } else if (op === "=") {
          out.push({ name: "minlength", value: { kind: "string-literal", value: numStr } });
          out.push({ name: "maxlength", value: { kind: "string-literal", value: numStr } });
        }
        // ">" / "<" / "!=" — not HTML-native (no off-by-one HTML attr); skip.
      }
      continue;
    }

    // All other validators are validity-surface-only; no HTML-attr lowering.
  }
  return out;
}

/**
 * Generate HTML from markup AST nodes.
 * Also populates the BindingRegistry for client JS wiring.
 */
export function generateHtml(
  nodes: any[],
  ctxOrErrors: CompileContext | CGError[] | null,
  csrfEnabledLegacy?: boolean,
  registryLegacy?: BindingRegistry | null,
  fileASTLegacy?: any,
  // ss15 item-2 (S214) -- when true, this generateHtml invocation lowers a
  // NESTED markup-render subtree (an engine/match arm body) rather than the
  // top-level file. The subtree is NOT a §40.8 default-logic root: its bare-
  // expr / `${...}` children RENDER. Seeding the parent-tag stack with a non-
  // default-logic sentinel makes the logic-node default-logic guard NOT fire
  // on arm-body interpolations. Top-level callers omit it (default false) so
  // a file-root bare-expr is correctly classified as a default-logic effect.
  nestedMarkupContext?: boolean,
): string {
  // Support both new (nodes, ctx) and legacy (nodes, errors, csrfEnabled, registry, fileAST) signatures
  let errors: CGError[];
  let csrfEnabled: boolean;
  let registry: BindingRegistry | null | undefined;
  let fileAST: any;
  // S91 A-4.4 — capture the live CompileContext (when present) so the
  // `<a data-scrml-prefetch>` wiring can both consult `routeMap.pages`
  // for internal-route resolution AND set `hasPrefetchableLinks` on the
  // shared ctx. The legacy positional signature has no ctx; the prefetch
  // wiring is then skipped (test fixtures + non-pipeline callers don't
  // need it — they emit straight HTML without per-route chunk hooks).
  let liveCtx: CompileContext | null = null;
  if (ctxOrErrors && typeof ctxOrErrors === "object" && "fileAST" in ctxOrErrors) {
    // New CompileContext signature
    const ctx = ctxOrErrors as CompileContext;
    errors = ctx.errors;
    csrfEnabled = ctx.csrfEnabled;
    registry = ctx.registry;
    fileAST = ctx.fileAST;
    liveCtx = ctx;
  } else {
    // Legacy positional signature
    errors = (ctxOrErrors as CGError[] | null) ?? [];
    csrfEnabled = csrfEnabledLegacy ?? false;
    registry = registryLegacy;
    fileAST = fileASTLegacy;
  }
  const parts: string[] = [];

  // S91 A-4.4 — Pre-build the set of known-internal URL patterns from
  // `RouteMap.pages`. Used per `<a href>` attribute to decide whether
  // to emit `data-scrml-prefetch`. We collect the urlPatterns into a
  // Set<string> for O(1) lookup; the patterns are exact route paths
  // (e.g. "/loads", "/admin", "/"). A-4.7 will extend this to handle
  // pattern-with-params (`/loads/:id`) by URL-template matching; A-4.4
  // ships exact-match-only (the §40.9.9 worked example uses static
  // paths).
  //
  // Defensive: when `liveCtx` is null (legacy signature) OR
  // `routeMap.pages` is missing / not a Map, we get the empty set —
  // every `<a href>` falls through the lookup and no
  // `data-scrml-prefetch` is emitted. Existing fixtures stay
  // byte-identical.
  const internalRoutes: Set<string> = (() => {
    if (!liveCtx) return new Set<string>();
    const pages = liveCtx.routeMap?.pages;
    if (!pages || typeof pages.values !== "function") return new Set<string>();
    const set = new Set<string>();
    for (const entry of pages.values()) {
      const urlPattern: unknown = (entry as { urlPattern?: unknown })?.urlPattern;
      if (typeof urlPattern === "string" && urlPattern !== "") set.add(urlPattern);
    }
    return set;
  })();

  /**
   * S91 A-4.4 — Resolve an `<a href>` value to a known internal route
   * (urlPattern in `RouteMap.pages`) or return `null` if the href is
   * external / unresolved / not a path.
   *
   * Rules (exact-match, conservative — A-4.7 may extend to pattern
   * matching):
   *   - Empty / non-string → null.
   *   - Fragment-only (`#section`) → null.
   *   - Protocol-bearing (`http://`, `https://`, `mailto:`, etc.) → null.
   *   - Relative without leading `/` (`foo`, `./bar`) → null (rare
   *     in scrml apps which use absolute paths).
   *   - Absolute path NOT matching any `RouteMap.pages.urlPattern` → null.
   *   - Absolute path that exactly matches a `urlPattern` → the
   *     pattern (the route key).
   *
   * The returned route is the literal urlPattern string from RouteMap;
   * the runtime hover-handler uses it as the `routePath` arg to
   * `_scrml_prefetch_tier2(routePath, role)`.
   */
  function resolveInternalRoute(hrefRaw: string): string | null {
    if (typeof hrefRaw !== "string" || hrefRaw === "") return null;
    if (hrefRaw.startsWith("#")) return null; // fragment-only
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(hrefRaw)) return null; // protocol-bearing
    if (!hrefRaw.startsWith("/")) return null; // not an absolute path
    // Strip any query/fragment so `/loads?x=1` and `/loads#top` both
    // resolve to `/loads`. The runtime handler can still navigate to
    // the original target on click — we only care about route shape
    // for prefetch.
    const q = hrefRaw.indexOf("?");
    const h = hrefRaw.indexOf("#");
    let path = hrefRaw;
    if (q !== -1 || h !== -1) {
      const cutAt = (q !== -1 && h !== -1) ? Math.min(q, h) : Math.max(q, h);
      path = hrefRaw.substring(0, cutAt);
    }
    if (internalRoutes.has(path)) return path;
    return null;
  }

  const reactiveVarNames: Set<string> | null = fileAST ? collectReactiveVarNames(fileAST) : null;

  // §65.3.2 / §65.4 (Task 2 [86]) — the flat-inline `#{}` token-lowering context.
  // Collected from the FULL file AST (`fileAST` is shared across the top-level
  // call AND every nested arm-body call in emit-variant-guard), so a flat-inline
  // `@brand` inside a match/engine arm still resolves the program-scope `<theme>`
  // tokens. `nodes` alone would miss them (it is the arm subtree in nested calls).
  // Built UNCONDITIONALLY (mirrors the selector path in generateCss, which always
  // builds its LowerCtx): a `@name` matching no token / no cell fires
  // E-THEME-TOKEN-UNKNOWN even in a themeless file — identical membership + error
  // semantics to the selector path. `lowerCssValueRefs` no-ops on values without
  // an `@`, so the flat-inline render stays byte-identical for non-`@` values.
  // FIX2 (S265 review) — `cellNames` MUST be the COMPLETE reactive-var set
  // (`collectReactiveVarNames`: state + DERIVED (`const d = @a*2`) + tilde + engine
  // / machine-projected vars), NOT `collectThemeContext().cellNames` (state-decl
  // only). A `#{ width: @doubled }` referencing a derived cell keeps the §25
  // bridge (`var(--scrml-doubled)`), NOT a false E-THEME-TOKEN-UNKNOWN.
  const flatInlineLowerCtx: LowerCtx | null = (() => {
    const topNodes = (fileAST as any)?.ast?.nodes ?? (fileAST as any)?.nodes ?? nodes;
    if (!Array.isArray(topNodes)) return null;
    const themeContext = collectThemeContext(topNodes);
    return {
      themeTokens: collectThemeTokenNames(themeContext),
      cellNames: reactiveVarNames ?? themeContext.cellNames,
      errors,
    };
  })();

  // §6.7.7 / §60.4 — `<request>` id set. A `${<#id>.data}` / `if=<#id>.loading`
  // interpolation reads a REACTIVE `_scrml_request_<id>` object (deep-reactive
  // Proxy) but carries NO `@var` ref, so `extractReactiveDeps` returns empty and
  // the binding would fall to the non-reactive one-shot path. We mark such a
  // binding with `hasRequestRef` so emit-event-wiring forces the `_scrml_effect`-
  // wrapped path (the Proxy auto-tracks the read → re-renders on fetch resolve).
  const requestIdsForBindings: Set<string> = fileAST ? collectRequestIds(fileAST) : new Set<string>();
  const exprHasRequestRef = (expr: string): boolean => {
    if (!expr || requestIdsForBindings.size === 0) return false;
    // Form 1: the literal `<#id>` sigil (survives raw in some paths).
    if (expr.includes("<#")) {
      const re = /<#([A-Za-z_$][A-Za-z0-9_$]*)>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(expr)) !== null) {
        if (requestIdsForBindings.has(m[1])) return true;
      }
    }
    // Form 2: the already-lowered bare `_scrml_input_<id>_` form produced by the
    // TAB stage (`preprocessWorkerAndStateRefs`) for a `${<#id>...}` interpolation
    // BEFORE codegen runs. The trailing-`_` anchor (NON-identifier-char after it)
    // distinguishes a user id-ref from a runtime helper (`_scrml_input_mouse_create`).
    if (expr.includes("_scrml_input_")) {
      const re2 = /_scrml_input_([A-Za-z_$][A-Za-z0-9_$]*?)_(?![A-Za-z0-9_$])/g;
      let m2: RegExpExecArray | null;
      while ((m2 = re2.exec(expr)) !== null) {
        if (requestIdsForBindings.has(m2[1])) return true;
      }
    }
    return false;
  };
  const fnBodyRegistry = fileAST ? buildFunctionBodyRegistry(fileAST) : null;
  // A1c C3 — file-scope handle for render-by-tag tag→cell resolution.
  // `runSYM` (symbol-table.ts:6271) attaches `_scope` non-enumerably to the FileAST.
  // When the AST was constructed without SYM (raw test fixtures), fileScope is null
  // and render-by-tag detection is skipped — the legacy raw-tag emission path keeps
  // working for tests that bypass symbol-table population.
  // S139 Bug 51 fix — the `fileAST` parameter passed by codegen runners is
  // sometimes the FileAST itself and sometimes the {filePath, ast, errors}
  // wrapper produced by TAB/CE. SYM attaches `_scope` non-enumerably to the
  // INNER FileAST (symbol-table.ts:9521); if the wrapper is what we have,
  // `fileAST._scope` is undefined. Mirror the shape-agnostic pattern used by
  // collect.ts:getNodes — try the direct path first, fall back to the inner.
  // Pre-fix: every adopter file compiled through TAB→CE→CG silently lost
  // `_scope` (only unit tests calling runSYM directly + passing the result
  // saw render-by-tag fire); Shape 2 cells + `<formFor>` use-sites left their
  // tag literal in HTML and emitted `_scrml_reactive_set("name", )` (empty
  // arg) — adopter-visible miscompile. See Bug 51 in known-gaps for the
  // empirical reproducer + the corpus-coverage gap that masked it.
  const fileScope: any = fileAST?._scope ?? fileAST?.ast?._scope ?? null;
  // A1c C16 — §53.7.1: map reactive var names to type annotations so bind:value
  // attributes can derive HTML validation attrs from refinement-type predicates.
  // Walk the AST top-level (mirrors emit-bindings.ts §53.7.2 path) — works whether
  // or not SYM populated _scope, so test fixtures without scope still get attrs.
  const reactiveTypeMap: Map<string, string> = fileAST ? buildReactiveTypeMap(fileAST) : new Map();

  // errorBoundary (SPEC §19.6) — per-file variant -> renders-markup map, built
  // once. Keyed by enum type name; each entry maps variant name -> raw renders
  // markup. Empty when the file declares no enum with a `renders` clause.
  const enumRenders = fileAST ? collectEnumRenders(fileAST) : new Map();

  // The active <errorBoundary> nesting stack. The innermost boundary (top of
  // stack) is the one a `${...}` interpolation's logic binding is stamped with;
  // inner-catches-first nesting (§19.6.4) falls out of the runtime backstop's
  // try/catch nesting, which mirrors this lexical stack.
  interface ActiveBoundary {
    boundaryId: string;
    fallbackExpr: string;        // JS string expr for the fallback HTML ("" if none)
    hasFallback: boolean;
    variantRenders: Record<string, string>; // variant name -> JS string expr (refs _eb_result.data)
  }
  const boundaryStack: ActiveBoundary[] = [];

  // ss20 item-1 (g-if-guard-inner-effect-not-gated) — the active `if=` DISPLAY-
  // TOGGLE guard stack. When the markup walker enters a standalone `if=` element
  // that fell through to the display-toggle path (NOT the clean-subtree
  // mount/unmount path, which returns early above; NOT `show=`, which keeps
  // running its inner effects), it pushes the if='s guard fields here before
  // recursing into children. A `${...}` interpolation descendant stamps the
  // top-of-stack onto its LogicBinding as `ifGuard` so emit-event-wiring gates
  // the inner interpolation effect on the SAME predicate the toggle uses — the
  // effect body short-circuits while the guard is false, preventing a
  // `null.field` crash on mount when the guarded cell starts absent. Popped on
  // the way out. Empty stack → no enclosing if= guard.
  interface IfDisplayGuard {
    condExpr?: string;
    condExprNode?: any;
    refs?: string[];
    varName?: string;
    dotPath?: string;
    // ss21 item-3 (g-if-chain-branch-display-null-interp) — set instead of the
    // single-`if=` fields when the walker enters an if-CHAIN branch (if=/else-
    // if=/else, whose if= attr is stripped before the generic markup walk, so
    // the single-`if=` push above never fires). `own` = the branch's own
    // condition (undefined for the else); `priors` = every prior positive
    // branch condition. emit-event-wiring lowers these to the branch's `_next
    // === branchId` visibility (priors-false AND own-true; else = all-priors-
    // false), lockstep with the chain controller.
    chainGuard?: { own?: any; priors?: any[] };
  }
  const ifGuardStack: IfDisplayGuard[] = [];

  // ss15 item-2 (S214) -- enclosing-markup-element tag stack. The logic-node
  // branch keys on the immediate parent tag to decide render-slot vs effect:
  // an empty stack means file top-level (a default-logic root); a top-of-stack
  // in DEFAULT_LOGIC_MODE_TAGS (<program>/<page>/<channel>) means a default-
  // logic body -- a bare-expr there is a mount EFFECT, not a render. Any other
  // top-of-stack is a real markup element -- a `${...}` child renders. Pushed
  // around the generic markup-element children walk only (the one walk that can
  // legitimately contain a default-logic root or a markup-interpolation child).
  // When this is a nested markup-render subtree (engine/match arm body), seed
  // the stack with a non-default-logic sentinel so arm-body `${...}` children
  // render (the file-root empty-stack default-logic semantics apply ONLY to
  // the top-level file compilation).
  const markupParentStack: string[] = nestedMarkupContext ? ["__nested-markup__"] : [];

  // Bug 60 (S157) — the active compound-parent wrapper nesting stack. When the
  // markup walker enters a BLOCK element whose tag resolves (via lookupStateCell
  // → getCellKind) to a `compound-parent` cell, it pushes that cell's name so a
  // nested self-tag `<field/>` child can resolve to the QUALIFIED leaf record
  // (`signupForm.userName`) via lookupQualifiedStateCell rather than failing the
  // bare-leaf lookup. The compound parent has no render-spec of its own, so the
  // wrapper element is TRANSPARENT — it emits no DOM element; its children's
  // render-by-tag expansions are emitted directly at the wrapper's DOM position
  // (SPEC §6.3.5:2209 — the structural form at the nested level). SPEC is silent
  // on whether `<signupForm>` block-wrappers emit a DOM element; the transparent
  // choice follows from the compound parent being render-spec-less (E-CELL-NO-
  // RENDER-SPEC is the SELF-tag `<x/>` rule per §34:16466, NOT the block-wrapper).
  const enclosingCompoundStack: string[] = [];

  // Build the full variant -> renders JS-expr map ONCE (every enum's renders,
  // flattened by variant name). A boundary's catchable variants are not known
  // statically here, so we offer ALL declared renders; the runtime dispatch
  // matches on the actual `result.variant`. Field substitution references
  // `_eb_result.data` (the error envelope's payload object).
  const allVariantRenderExprs: Record<string, string> = (() => {
    const out: Record<string, string> = {};
    for (const info of enumRenders.values()) {
      for (const [variant, rawMarkup] of info.renders) {
        const tpl = compileBoundaryMarkup(rawMarkup, generateHtml);
        const payloadFields = info.variantFields.get(variant);
        out[variant] = emitBoundaryMarkupExpr(tpl, "_eb_result.data", payloadFields);
      }
    }
    return out;
  })();

  // 6nz-F4 — RCDATA content-model analysis.
  //
  // A reactive `${}` content interpolation inside an RCDATA element
  // (`<textarea>`; SPEC §24.3.1 companion, SPEC.md:1141) must NOT lower to a
  // `<span data-scrml-logic>` placeholder: inside RCDATA the span is literal
  // text, not a mountable element, so the placeholder leaks verbatim as the
  // element's value (the F4 bug — repro.scrml). This helper walks a candidate
  // RCDATA element's children and, when at least one reactive interp is present,
  // returns the ordered content parts (static text runs + reactive expression
  // parts) so the caller can bind the concatenation to `.value` reactively and
  // render the const-known parts as static first-paint content.
  //
  // Returns null when the content has NO reactive interp — pure-static text and
  // const-folded interps already render correctly through the normal walk (the
  // const-fold path emits inline text, never a span), so those fall through
  // unchanged. Also returns null (bail) on any unsupported child shape (nested
  // markup, value-control-flow / multi-statement / lift logic), preserving prior
  // behavior for those unusual shapes rather than silently re-routing them.
  function analyzeRcdataContent(
    children: any[],
  ): Array<{ kind: "static"; text: string } | { kind: "expr"; expr: string; exprNode: any }> | null {
    const liveCtxForFold = ctxOrErrors && typeof ctxOrErrors === "object" && "fileAST" in ctxOrErrors
      ? (ctxOrErrors as CompileContext)
      : null;
    let tryFoldInterpolation: ((exprNode: any, fileAST: any) => string | null) | null = null;
    if (liveCtxForFold) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ({ tryFoldInterpolation } = require("./const-fold-env.ts") as {
        tryFoldInterpolation: (exprNode: any, fileAST: any) => string | null;
      });
    }
    const parts: Array<{ kind: "static"; text: string } | { kind: "expr"; expr: string; exprNode: any }> = [];
    let hasReactive = false;
    for (const child of children) {
      if (!child || typeof child !== "object") continue;
      if (child.kind === "text") {
        parts.push({ kind: "static", text: String(child.value ?? child.text ?? "") });
        continue;
      }
      if (child.kind === "comment") continue;
      if (
        child.kind === "logic" &&
        Array.isArray(child.body) &&
        child.body.length === 1 &&
        child.body[0]?.kind === "bare-expr"
      ) {
        const bare = child.body[0];
        const exprStr: string = bare.exprNode ? emitStringFromTree(bare.exprNode) : (bare.expr ?? "");
        // Skip an empty / whitespace-only interp (e.g. a `${ }` that stringifies
        // empty) — pushing it as an expr part would make the wiring emit
        // `el.value = "" + ()` (a SyntaxError). Mirrors the each-path guard
        // (`if (!inner) continue;`, eachRcdataValueExpr). Contributes nothing.
        if (!exprStr.trim()) continue;
        // Const-fold first — a compile-time-constant interp becomes a static
        // text run (this is the SAME fold the normal logic-node path applies, so
        // a const-only textarea never reaches the reactive path).
        let folded: string | null = null;
        if (liveCtxForFold && tryFoldInterpolation && bare.exprNode) {
          folded = tryFoldInterpolation(bare.exprNode, liveCtxForFold.fileAST);
        }
        if (folded !== null) {
          parts.push({ kind: "static", text: folded });
          continue;
        }
        parts.push({ kind: "expr", expr: exprStr, exprNode: bare.exprNode });
        hasReactive = true;
        continue;
      }
      // Unsupported child shape — bail (fall through to the normal per-child walk).
      return null;
    }
    if (!hasReactive) return null;
    return parts;
  }

  function emitNode(node: any): void {
    if (!node || typeof node !== "object") return;

    if (node.kind === "text") {
      parts.push(node.value ?? node.text ?? "");
      return;
    }

    if (node.kind === "comment") {
      return;
    }

    if (node.kind === "state") {
      // R25-Bug-41 (S138) — server-side-only state-block types (`<schema>`,
      // `<seeds>`) MUST NOT walk their children into the HTML body. The schema
      // block contains raw DDL text per §39.2 (`schema-block ::= '< schema>'
      // table-declaration* closer`); without this guard the text-kind branch
      // dumps every column declaration into the rendered page as prose. The
      // schema's actual DDL is emitted via the schemaFor walker + migration
      // diff path — server-only, never the HTML render-tree.
      const stateType = (node as any).stateType ?? "";
      if (SERVER_ONLY_STATE_TYPES.has(stateType)) {
        return;
      }
      // ss15 item-2 (S214) -- a <db>/<state> block body is markup context, NOT
      // a §40.8 default-logic root (E-WRITE-NOT-IN-LOGIC-CONTEXT: "<db>/<state>
      // STATE-block bodies are NOT default-logic-mode loci"). Push a non-default-
      // logic marker so a logic child keeps its pre-fix (markup) classification.
      markupParentStack.push("state");
      for (const child of node.children ?? []) {
        emitNode(child);
      }
      markupParentStack.pop();
      return;
    }

    // §17.1.1: if-chain — Phase 2g (mount/unmount per branch)
    //
    // Approach A + W-keep-chain-only + per-branch mixed-cleanliness dispatch:
    //   - Single chain wrapper `<div data-scrml-if-chain="N">` retained for
    //     adopter CSS targeting.
    //   - Per-branch dispatch:
    //     * Clean branch (no events / no reactive interp / no nested wiring):
    //       emit `<template id=...><inner></template><!--scrml-if-marker:...-->`.
    //       Per-branch wrapper DROPPED — the controller mounts/unmounts the
    //       template into the chain wrapper directly. Honors §17.1.1 line 7533
    //       ("only one span exists in the DOM at any time") for clean branches.
    //     * Dirty branch (has events, bind:, transitions, components, reactive
    //       interp, etc): retain pre-Phase-2g per-branch wrapper
    //       `<div data-scrml-chain-branch="K" style="display:none"><inner></div>`.
    //       Controller toggles `display` for these (today's display-toggle
    //       behavior, scoped per branch).
    //   - Strip-precursor (`stripChainBranchAttrs`) applies in BOTH paths to
    //     prevent if=/else-if=/else leakage and to prevent the inner element
    //     from re-triggering the standalone if= early-out gate at lines 575-603.
    //   - The chain controller in emit-event-wiring.ts reads the per-branch
    //     `branchMode` field and dispatches mount/unmount vs display-toggle
    //     per branch on the active-branch transition.
    //
    // Reuses Phase 2c B1 helpers (_scrml_create_scope, _scrml_mount_template,
    // _scrml_unmount_scope, _scrml_find_if_marker) verbatim. No new runtime
    // helpers. No spec amendment. See deep-dive
    // `docs/deep-dives/phase-2g-chain-mount-strategy-2026-04-29.md` §9.
    if (node.kind === "if-chain") {
      const chainId = genVar("if_chain");
      parts.push(`<div data-scrml-if-chain="${chainId}">`);

      // ss21 item-3 (g-if-chain-branch-display-null-interp) — positive branch
      // conditions in source order. A chain branch's descendant `${...}`
      // interpolation effects are gated on the branch's VISIBILITY (a separate
      // node kind from the single-`if=` ss20 path): all PRIOR positive
      // conditions false AND (own condition true, or it is the else). Pushing
      // `chainGuard` onto ifGuardStack around each DIRTY (display-mode) branch's
      // children walk stamps it onto the descendant interpolation LogicBindings;
      // clean (mount-mode) branches carry no reactive interp (they would not be
      // clean otherwise), so they need no push.
      const _chainPositiveConds: any[] = (node.branches ?? []).map((b: any) => b.condition);

      for (let bIdx = 0; bIdx < (node.branches?.length ?? 0); bIdx++) {
        const branch = node.branches[bIdx];
        const branchId = `${chainId}_b${bIdx}`;
        const isClean = isCleanChainBranch(branch.element);
        const stripped = stripChainBranchAttrs(branch.element);

        if (isClean) {
          // Clean branch: <template> + <!--scrml-if-marker:...-->
          const templateId = genVar("scrml_chain_tpl");
          const markerId = genVar("scrml_chain_marker");
          parts.push(`<template id="${templateId}">`);
          emitNode(stripped);
          parts.push(`</template>`);
          parts.push(`<!--scrml-if-marker:${markerId}-->`);
          if (registry) {
            registry.addLogicBinding({
              kind: "if-chain-branch",
              chainId,
              branchId,
              branchIndex: bIdx,
              branchMode: "mount",
              templateId,
              markerId,
              condition: branch.condition,
              refs: branch.condition?.refs ?? (branch.condition?.name ? [branch.condition.name.replace(/^@/, "")] : []),
            });
          }
        } else {
          // Dirty branch: per-branch wrapper retained, display-toggle.
          parts.push(`<div data-scrml-chain-branch="${branchId}" style="display:none">`);
          // ss21 item-3 — gate descendant interpolation effects on this branch's
          // visibility (all PRIOR positive conditions false AND own condition
          // true). Lockstep with the chain controller's `_next === branchId`.
          ifGuardStack.push({ chainGuard: { own: branch.condition, priors: _chainPositiveConds.slice(0, bIdx) } });
          emitNode(stripped);
          ifGuardStack.pop();
          parts.push(`</div>`);
          if (registry) {
            registry.addLogicBinding({
              kind: "if-chain-branch",
              chainId,
              branchId,
              branchIndex: bIdx,
              branchMode: "display",
              condition: branch.condition,
              refs: branch.condition?.refs ?? (branch.condition?.name ? [branch.condition.name.replace(/^@/, "")] : []),
            });
          }
        }
      }

      if (node.elseBranch) {
        const elseId = `${chainId}_else`;
        const isClean = isCleanChainBranch(node.elseBranch);
        const stripped = stripChainBranchAttrs(node.elseBranch);

        if (isClean) {
          const templateId = genVar("scrml_chain_tpl");
          const markerId = genVar("scrml_chain_marker");
          parts.push(`<template id="${templateId}">`);
          emitNode(stripped);
          parts.push(`</template>`);
          parts.push(`<!--scrml-if-marker:${markerId}-->`);
          if (registry) {
            registry.addLogicBinding({
              kind: "if-chain-else",
              chainId,
              branchId: elseId,
              branchMode: "mount",
              templateId,
              markerId,
            });
          }
        } else {
          parts.push(`<div data-scrml-chain-branch="${elseId}" style="display:none">`);
          // ss21 item-3 — the else is visible iff NO positive branch matched.
          // Gate its descendant interpolation effects on all positive conditions
          // false (own undefined). Lockstep with the chain controller's
          // `_next === elseId` fall-through.
          ifGuardStack.push({ chainGuard: { priors: _chainPositiveConds } });
          emitNode(stripped);
          ifGuardStack.pop();
          parts.push(`</div>`);
          if (registry) {
            registry.addLogicBinding({
              kind: "if-chain-else",
              chainId,
              branchId: elseId,
              branchMode: "display",
            });
          }
        }
      }

      parts.push(`</div>`);
      return;
    }

    if (node.kind === "markup") {
      const tag: string = node.tag ?? node.tagName ?? "div";
      const attrs: any[] = node.attributes ?? node.attrs ?? [];
      const children: any[] = node.children ?? [];
      const isSelfClosing: boolean = node.selfClosing === true && children.length === 0;
      const isVoid: boolean = VOID_ELEMENTS.has(tag);

      // 6nz-F4 — RCDATA content-model carve-out (SPEC §24.3.1 companion,
      // SPEC.md:1141). When this is an RCDATA element (`<textarea>`) with reactive
      // `${}` content interp, we bind the concatenated content to `.value`
      // instead of emitting the (invalid-in-RCDATA) `<span data-scrml-logic>`
      // placeholder. Computed here (before the open-tag close) so the
      // `data-scrml-rcdata` selector attribute can be stamped into the opener.
      // `_rcdataBindValueConflict` fires the edge-4 ruling: an explicit
      // `bind:value` on the same textarea is the canonical (two-way) value binding
      // (§5.4 / §6.2) and WINS — the redundant content interp is dropped + warned
      // (W-RCDATA-BIND-VALUE-CONTENT-CONFLICT), never double-bound.
      let _rcdataParts:
        | Array<{ kind: "static"; text: string } | { kind: "expr"; expr: string; exprNode: any }>
        | null = null;
      let _rcdataPlaceholderId: string | null = null;
      if (isRcdataElement(tag) && !isSelfClosing && !isVoid) {
        _rcdataParts = analyzeRcdataContent(children);
        if (_rcdataParts) {
          const _bvAttr = attrs.find(
            (a: any) => a && (a.name === "bind:value" || a.name === "bind:valueAsNumber"),
          );
          if (_bvAttr) {
            // bind:value wins (edge-4 ruling); no placeholder is allocated, so the
            // carve-out below drops the content (bind:value drives `.value`).
            if (errors) {
              errors.push(new CGError(
                "W-RCDATA-BIND-VALUE-CONTENT-CONFLICT",
                `W-RCDATA-BIND-VALUE-CONTENT-CONFLICT: <${tag}> has BOTH a \`${_bvAttr.name}\` binding AND reactive \`\${...}\` body content.\n` +
                `  These are contradictory value sources. \`${_bvAttr.name}\` is the canonical two-way value binding (§5.4 / §6.2) and takes precedence;\n` +
                `  the reactive body interpolation is dropped (it would fight the binding for control of \`.value\`).\n` +
                `  Resolution: keep \`${_bvAttr.name}\` and remove the \`\${...}\` body, or remove \`${_bvAttr.name}\` and keep the body (one-way display).`,
                (node as any).span ?? { file: "", start: 0, end: 0, line: 0, col: 0 },
                "warning",
              ));
            }
          } else {
            _rcdataPlaceholderId = genVar("rcdata");
          }
        }
      }

      if (tag === "outlet") {
        // SPEC §20.8.1 (Client Router — navigate-soft-nav Wave-1a). `<outlet>`
        // is the persistent-shell swap region: the current route's content
        // renders here, and a soft navigation (§20.8.2) swaps this subtree with
        // the target route's `<outlet>` content over the live shell.
        //
        // Wave-1a emits a stable, addressable region marker — a `<div
        // data-scrml-outlet>` (mirroring the `data-scrml-each-mount` /
        // `data-scrml-error-boundary` anchor convention). A `<div>` (not the raw
        // `<outlet>` custom element) is the block-level region a page-content
        // slot needs, and `[data-scrml-outlet]` is the impl-stable selector the
        // Wave-1b runtime swap + focus (§20.8.5 item 3) will address.
        //
        // Rather than reimplement `if=` guarding, class/id (interpolation-aware)
        // emission, and markup-parent child handling, we REWRITE the outlet to a
        // `div` carrying a synthetic `data-scrml-outlet` marker + the outlet's
        // own attrs, and DELEGATE to the generic markup path. That path already
        // honors the universal `if=` directive (mount/unmount OR display-toggle),
        // emits the registered `class` / `id` (static or `${}`-interpolated), and
        // pushes the markup-parent context so a `<outlet>${x}</outlet>` logic
        // child keeps its render slot. `selfClosing` is forced false so a
        // `<outlet/>` void slot still emits the container form `<div…></div>`
        // (never a `<div/>`, which HTML does not self-close). Re-entry is safe:
        // the rewritten tag is `div`, so the outlet branch does not re-trigger.
        const outletMarkerAttr = { name: "data-scrml-outlet", value: null };
        // §20.8.5(3) focus-after-swap (navigate-wave1b) — the region is the
        // focus target the soft-nav runtime moves keyboard/AT focus to after a
        // swap. A `tabindex="-1"` makes the container programmatically focusable
        // (not in the tab order) so `outlet.focus()` works. Skip when the author
        // already set a tabindex on the `<outlet>` (respect an explicit value).
        const outletHasTabindex = attrs.some(
          (a: any) => a && typeof a.name === "string" && a.name.toLowerCase() === "tabindex",
        );
        const outletFocusAttrs = outletHasTabindex
          ? [outletMarkerAttr]
          : [outletMarkerAttr, { name: "tabindex", value: { kind: "string-literal", value: "-1" } }];
        // navigate-wave1c (Option A ruling) — the `<outlet>` region emits as a
        // `<main data-scrml-outlet tabindex="-1">`, NOT a `<div>`. This unifies the
        // §20.8 soft-nav swap region with the multi-file MPA shell-composition slot
        // (index.ts): the composition is MARKER-driven (keys on `[data-scrml-outlet]`,
        // falling back to a bare `<main>` for the static/hard-nav back-compat path),
        // so a `<page>` route body composes INTO this element — the composed route
        // page then carries `[data-scrml-outlet]`, which the runtime swap addresses.
        // `<main>` is the correct landmark for the primary route-content region.
        const outletMainNode = {
          ...node,
          tag: "main",
          tagName: "main",
          selfClosing: false,
          attributes: [...outletFocusAttrs, ...attrs],
          attrs: [...outletFocusAttrs, ...attrs],
        };
        emitNode(outletMainNode);
        return;
      }

      if (tag === "errorBoundary" || tag === "errorboundary") {
        // SPEC §19.6 — markup-context error catch. The boundary wraps a subtree
        // in which `!`-function calls may produce error variants; those are
        // routed (§19.6.3/§19.6.5) to the variant's own `renders` markup or, if
        // absent, the boundary's `fallback=` markup. A C-hybrid host-JS backstop
        // (§19.6.8) additionally degrades non-`!` throws to the fallback.
        const boundaryId = genVar("error_boundary");

        // Resolve the `fallback={<markup/>}` attribute into a runtime HTML expr.
        const fallbackAttr = attrs.find((a: any) => a.name === "fallback");
        let fallbackExpr = '""';
        let hasFallback = false;
        if (fallbackAttr && fallbackAttr.value) {
          const fv: any = fallbackAttr.value;
          // The attr value is an `expr` wrapper whose `raw` holds the markup
          // source (e.g. `<div>Something went wrong</>`), or an escape-hatch
          // node carrying the same in `.raw`.
          const rawMarkup: string =
            (typeof fv.raw === "string" ? fv.raw : undefined) ??
            (fv.exprNode && typeof fv.exprNode.raw === "string" ? fv.exprNode.raw : "") ?? "";
          if (rawMarkup.trim() !== "") {
            const tpl = compileBoundaryMarkup(rawMarkup, generateHtml);
            fallbackExpr = emitBoundaryMarkupExpr(tpl, "_eb_result && _eb_result.data");
            hasFallback = true;
          }
        }

        // The data-attr carries the boundary id only — the fallback HTML +
        // variant renders are emitted into the JS wiring (emit-event-wiring.ts),
        // NOT inlined into the static HTML, so server-only markup never leaks
        // and the static page stays minimal.
        parts.push(`<div data-scrml-error-boundary="${boundaryId}">`);

        boundaryStack.push({
          boundaryId,
          fallbackExpr,
          hasFallback,
          variantRenders: allVariantRenderExprs,
        });
        // ss15 item-2 (S214) -- the boundary emits a real <div> wrapper; its
        // `${...}` children are markup-interpolations that render (NOT a
        // default-logic body). Push a non-default-logic tag so a logic child
        // nested directly under a <program>-level boundary keeps its slot.
        markupParentStack.push("errorBoundary");
        for (const child of children) {
          emitNode(child);
        }
        markupParentStack.pop();
        boundaryStack.pop();

        parts.push("</div>");
        return;
      }

      // ---------------------------------------------------------------------
      // Bug 60 (S157) — Compound-parent wrapper transparency (SPEC §6.3.5:2209).
      //
      // A BLOCK-form `<signupForm>...</signupForm>` whose tag resolves to a
      // registered `compound-parent` cell is a NAMESPACE wrapper, not a render-
      // spec element. Per §6.3.5 line 2209 the nested structural form
      // `<formRes><name/></>` is valid render-by-tag for `name` "at the nested
      // level" — i.e. the nested `<name/>` self-tag children expand to their
      // OWN render-spec, keyed on the qualified cell path. The compound parent
      // itself has NO render-spec (E-CELL-NO-RENDER-SPEC is the SELF-tag `<x/>`
      // rule per §34:16466 — it does NOT fire on the block-wrapper form), so it
      // emits NO DOM element of its own: the wrapper is TRANSPARENT. We push the
      // compound name onto `enclosingCompoundStack` for the duration of the
      // child walk so the render-by-tag self-tag block (below) can resolve each
      // `<field/>` child via lookupQualifiedStateCell and expand it bound to the
      // qualified runtime cell (`signupForm.userName`). Children that are NOT
      // recognised compound fields fall through unchanged (the bare render-by-
      // tag / literal-tag paths still apply within the namespace).
      //
      // Self-closing `<compound/>` form is NOT a namespace wrapper (no body);
      // it routes through the normal render-by-tag block below, where a compound
      // parent has cellKind "compound-parent" (not "bindable") and correctly
      // does NOT expand — surfacing E-CELL-NO-RENDER-SPEC upstream at B6.
      if (
        !isSelfClosing &&
        fileScope &&
        /^[a-z]/.test(tag) &&
        !VOID_ELEMENTS.has(tag) &&
        !LIFECYCLE_SILENT_TAGS.has(tag) &&
        !INPUT_STATE_TAGS.has(tag) &&
        !REQUEST_TAGS.has(tag) &&
        !TIMEOUT_TAGS.has(tag) &&
        tag !== "channel" &&
        tag !== "errorBoundary" && tag !== "errorboundary" &&
        tag !== "program" && tag !== "errors"
      ) {
        const wrapperDecl = lookupStateCell(fileScope, tag);
        const wrapperKind = wrapperDecl ? getCellKind(wrapperDecl.declNode as any) : undefined;
        if (wrapperDecl && wrapperKind === "compound-parent") {
          enclosingCompoundStack.push(tag);
          // ss15 item-2 (S214) -- the compound-parent wrapper is a markup
          // namespace element (its tag is never a default-logic tag); its
          // children render. Push the tag so a logic child resolves to
          // markup-interpolation mode, not the enclosing default-logic root.
          markupParentStack.push(tag);
          for (const child of children) {
            emitNode(child);
          }
          markupParentStack.pop();
          enclosingCompoundStack.pop();
          return;
        }
      }

      // ---------------------------------------------------------------------
      // A1c C11 — `<errors of=expr/>` first-class element (SPEC §55.8, L13).
      //
      // Two attribute shapes:
      //   - of=@compound.field → per-field; reads <compound>.<field>.errors
      //     array of validation tags. Default renders the first tag wrapped in
      //     `<p class="scrml-error">${ messageFor(tag, fieldName) }</p>`.
      //     `all` flag iterates the full array.
      //   - of=@compound → compound rollup; reads <compound>.errors object map
      //     `{field: [tags]}`. `all` flag iterates Object.entries(map).
      //
      // When the source errors array/map is empty, NO DOM is rendered (per
      // SPEC line 25193-25195: "literally nothing rendered"). The anchor span
      // remains in the DOM as the re-render hookpoint, but its innerHTML is
      // empty when there are no errors.
      //
      // Body override (SPEC line 25197-25207): when the element body contains
      // an arrow-function-shaped expression `${(err) => <markup>}`, the body
      // REPLACES the default render. The compiler captures the body as a JS
      // arrow function; the runtime applies it per error tag.
      //
      // No-validator fields (SPEC line 25209-25210): legal and produces no DOM
      // — handled trivially since C7+C8 emit `errors === []` for fields with
      // no validators (the empty-array path applies unconditionally).
      //
      // The `messageFor` 4-level resolution chain (§55.10) is C10 sibling
      // territory. Until C10 lands, the runtime uses a stub helper that
      // returns the raw tag name; this is documented in the dispatch and
      // PA reconciles when C10 is shipped.
      // ---------------------------------------------------------------------
      if (tag === "errors") {
        const span = node.span ?? { file: "", start: 0, end: 0, line: 1, col: 1 };
        const ofAttr = attrs.find((a: any) => a.name === "of");
        const allAttr = attrs.find((a: any) => a.name === "all");

        // VP-style validation: `of=` is REQUIRED. Surface as warning rather
        // than error — keeps the page rendering even with a malformed `<errors>`.
        if (!ofAttr) {
          if (errors) {
            errors.push(new CGError(
              "E-ERRORS-001",
              `E-ERRORS-001: \`<errors>\` is missing the required \`of\` attribute. ` +
              `The \`of=\` attribute references the source errors cell, e.g. ` +
              `\`<errors of=@signup.name/>\` (per-field) or \`<errors of=@signup all/>\` (compound rollup). ` +
              `See SPEC §55.8.`,
              span,
            ));
          }
          // Continue and emit an empty anchor so downstream rendering doesn't break.
        }

        // Resolve the `of=` reference → storage key root (without trailing
        // `.errors`). The value is a `variable-ref` AST node like
        // `{kind: "variable-ref", name: "@signup.name"}` (per parser).
        // We strip the leading `@` and pass through; the compound-vs-per-field
        // distinction is the presence of a dot in the dotted path.
        let errorsKey: string | null = null;
        let isCompoundRollup = false;
        let fieldName: string | undefined;
        if (ofAttr) {
          const ofVal = ofAttr.value;
          if (ofVal && ofVal.kind === "variable-ref" && typeof ofVal.name === "string") {
            const raw = ofVal.name.replace(/^@/, "");
            // raw is like "signup.name" (per-field) or "signup" (compound),
            // or "outer.inner" (compound) or "outer.inner.field" (multi-level
            // per-field, §6.3.5 multi-level compound nav). Distinguishing
            // compound-rollup vs per-field at codegen-time without symbol-table
            // lookup is impossible from the AST alone. Heuristic: treat the
            // path as per-field when it has at least one dot (the most common
            // shape — `<errors of=@compound.field/>`); compound rollup uses
            // a bare `<errors of=@compound/>` (no dot). Multi-level compound
            // nav (`@outer.inner.field`) lands in the per-field branch — still
            // correct, since the leaf cell's `errors` is always an array.
            //
            // The compound-rollup case (`@compound`) has no per-field name to
            // pass to `messageFor`; the iteration produces (fieldName, tag)
            // pairs, with messageFor(tag, fieldName).
            errorsKey = raw;
            const lastDot = raw.lastIndexOf(".");
            if (lastDot === -1) {
              // No dot → compound rollup (errors is an object map)
              isCompoundRollup = true;
            } else {
              // Has at least one dot → per-field (errors is an array)
              isCompoundRollup = false;
              fieldName = raw.substring(lastDot + 1);
            }
          } else if (errors) {
            errors.push(new CGError(
              "E-ERRORS-002",
              `E-ERRORS-002: \`<errors of=...>\` requires an \`@\`-rooted scrml expression. ` +
              `Got an unrecognized value shape. ` +
              `Example: \`<errors of=@signup.name/>\` or \`<errors of=@signup all/>\`. ` +
              `See SPEC §55.8.`,
              span,
            ));
          }
        }

        // `all` flag — present means render the full array; absent means
        // first error only. Per SPEC line 25186-25187. Treat any presence of
        // the attribute as truthy (boolean flag).
        const allFlag = allAttr !== undefined;

        // Body-override path. The arrow-function-shaped body is captured as a
        // logic-node child. We extract the raw expression text + its ExprNode
        // for emit-event-wiring to compile and apply per error.
        let bodyExpr: string | undefined;
        let bodyExprNode: any | undefined;
        for (const child of children) {
          if (!child || typeof child !== "object") continue;
          if (child.kind === "logic" && Array.isArray(child.body) && child.body.length > 0) {
            // Look for a single bare-expr that is arrow-function-shaped.
            const bare = child.body.find((b: any) => b && b.kind === "bare-expr");
            if (bare) {
              const raw: string = bare.exprNode
                ? emitStringFromTree(bare.exprNode)
                : (bare.expr ?? "");
              if (raw && /^\s*\(?\s*[a-zA-Z_$][\w$]*\s*\)?\s*=>/.test(raw)) {
                bodyExpr = raw;
                bodyExprNode = bare.exprNode;
                break;
              }
            }
          }
        }

        const anchorId = genVar("scrml_errors");
        parts.push(`<span data-scrml-errors-anchor="${anchorId}"></span>`);

        if (registry && errorsKey !== null) {
          registry.addLogicBinding({
            kind: "errors-element",
            anchorId,
            errorsKey,
            isCompoundRollup,
            allFlag,
            ...(fieldName !== undefined ? { fieldName } : {}),
            ...(bodyExpr !== undefined ? { bodyExpr, bodyExprNode } : {}),
          } as any);
        }
        return;
      }

      // ---------------------------------------------------------------------
      // render-expr-primitive — `<render of=X/>` (SPEC §19.x, §19.2).
      //
      // Fires the HELD enum value X's per-variant `renders` contract (§19.2) at
      // this markup position. X is commonly a `<match>` arm payload binding
      // (`<Failed err> <render of=err/> </>`) — a local JS parameter in the arm
      // render/wire function scope — or an `@cell` holding an enum value.
      //
      // CONTRACT-FIRING primitive (limit-the-primitive axiom, RATIFIED S195
      // a/c): it dispatches X to its enum's per-variant `renders` markup. It
      // never falls back to a tag string, never infers, never generalizes the
      // `renders` grammar (stays error-enum-scoped). The exhaustiveness fence
      // (every reachable variant of X's enum MUST declare `renders`) is the
      // typer's E-RENDER-NO-CLAUSE (type-system.ts; reuses the §19.6.6
      // E-ERROR-005 per-variant logic), so by the time codegen runs every
      // variant has a `renders` template here.
      //
      // CODEGEN REUSE: the per-variant render markup compiles via the SAME
      // `compileBoundaryMarkup` + `emitBoundaryMarkupExpr` the `<errorBoundary>`
      // path uses — the ONLY difference is the firing site + the `dataExpr`.
      // The boundary path passes `_eb_result.data` (the caught error envelope's
      // payload); here we pass `(<heldValue>).data` (the held value's payload).
      // This SIDESTEPS the `__scrml_error` envelope gate entirely
      // (emit-event-wiring.ts) — the held value is never pretended to be a
      // thrown error; we dispatch on its OWN `.variant` against its OWN `.data`.
      // `<errorBoundary>` codegen is left untouched (§19.6.1).
      // ---------------------------------------------------------------------
      if (tag === "render") {
        const span = node.span ?? { file: "", start: 0, end: 0, line: 1, col: 1 };
        const ofAttr = attrs.find((a: any) => a.name === "of");

        // `of=` is REQUIRED. The typer fires E-RENDER-NO-OF (fatal); here we
        // surface the same code defensively so a registry-bypassing test path
        // also reports it, then emit an empty anchor so HTML rendering proceeds.
        if (!ofAttr || !ofAttr.value) {
          if (errors) {
            errors.push(new CGError(
              "E-RENDER-NO-OF",
              `E-RENDER-NO-OF: \`<render>\` is missing the required \`of\` attribute. ` +
              `The \`of=\` attribute references the held enum value to display, e.g. ` +
              `\`<render of=err/>\` (a \`<match>\` arm payload binding) or \`<render of=@cell/>\`. ` +
              `See SPEC §19.x.`,
              span,
            ));
          }
          parts.push(`<span data-scrml-render-anchor="${genVar("scrml_render")}"></span>`);
          return;
        }

        // Resolve `of=` → the held value's runtime JS accessor.
        //   - bare ident `err`   → a local binding (match-arm payload param /
        //                          engine-arm payload). Lower to the plain JS
        //                          identifier; it is in scope inside the arm
        //                          render/wire fn the binding is tagged with.
        //   - `@cell`            → a reactive cell. Lower to
        //                          `_scrml_reactive_get("cell")`.
        // The held value at runtime is `{ variant, data }` for a payload-bearing
        // variant or a bare string tag for a unit variant — the same shape the
        // engine/match dispatcher reads (emit-variant-guard.ts).
        const ofVal = ofAttr.value as { kind?: string; name?: string };
        let heldAccessor: string | null = null;
        let heldSubscribe: string | null = null;   // @cell name to subscribe (null for a local binding)
        if ((ofVal.kind === "variable-ref" || ofVal.kind === "ident") && typeof ofVal.name === "string" && ofVal.name.length > 0) {
          if (ofVal.name.startsWith("@")) {
            const cellName = ofVal.name.slice(1);
            // Dotted path (`@compound.field`) — read the root cell then walk.
            const dot = cellName.indexOf(".");
            if (dot === -1) {
              heldAccessor = `_scrml_reactive_get(${JSON.stringify(cellName)})`;
              heldSubscribe = cellName;
            } else {
              const root = cellName.slice(0, dot);
              const path = cellName.slice(dot); // includes leading "."
              heldAccessor = `(_scrml_reactive_get(${JSON.stringify(root)}))${path}`;
              heldSubscribe = root;
            }
          } else {
            // Local binding (match-arm / engine-arm payload). Plain JS ident.
            heldAccessor = ofVal.name;
            heldSubscribe = null;
          }
        } else if (errors) {
          errors.push(new CGError(
            "E-RENDER-NO-OF",
            `E-RENDER-NO-OF: \`<render of=...>\` requires an \`@\`-rooted cell or a held ` +
            `enum binding as its \`of=\` value. Got an unrecognized value shape. ` +
            `Example: \`<render of=err/>\` or \`<render of=@phase/>\`. See SPEC §19.x.`,
            span,
          ));
        }

        // Build the per-variant render-markup dispatch keyed by variant name,
        // substituting THIS held value's `.data` as the runtime payload source.
        // enumRenders is the file's per-enum variant->renders map (collected at
        // the top of generateHtml; the SAME source the boundary path reads).
        const variantRenderExprs: Record<string, string> = {};
        for (const info of enumRenders.values()) {
          for (const [variant, rawMarkup] of info.renders) {
            const tpl = compileBoundaryMarkup(rawMarkup, generateHtml);
            const payloadFields = info.variantFields.get(variant);
            // dataExpr — the held value's payload object. `(acc).data` mirrors
            // the boundary's `_eb_result.data`. The `(acc) != null` guard in
            // emitBoundaryMarkupExpr keeps a unit-variant (bare-string held
            // value, `.data` undefined) from throwing on field substitution.
            variantRenderExprs[variant] = emitBoundaryMarkupExpr(
              tpl,
              heldAccessor ? `(${heldAccessor}).data` : `(null)`,
              payloadFields,
            );
          }
        }

        const anchorId = genVar("scrml_render");
        parts.push(`<span data-scrml-render-anchor="${anchorId}"></span>`);

        if (registry && heldAccessor !== null) {
          registry.addLogicBinding({
            kind: "render-element",
            anchorId,
            renderHeldAccessor: heldAccessor,
            ...(heldSubscribe !== null ? { renderHeldSubscribe: heldSubscribe } : {}),
            renderVariantExprs: variantRenderExprs,
          } as any);
        }
        return;
      }

      if (tag === "program") {
        // Named programs are worker bundles (§4.12.4) — skip entirely.
        // Only emit children for the unnamed/root program.
        const nameAttr = attrs.find((a: any) => a.name === "name");
        if (nameAttr) return;
        // ss15 item-2 (S214) -- the unnamed <program> is a DEFAULT-LOGIC root
        // (§40.8). Push its tag so a bare-expr logic child resolves to effect
        // mode (no render slot); a `${...}` nested in a real markup descendant
        // still renders (that descendant pushes its own tag in the generic walk).
        markupParentStack.push(tag);
        for (const child of children) {
          emitNode(child);
        }
        markupParentStack.pop();
        return;
      }

      // mpa-shell-clean-urls (2026-05-17): the `<page>` element (§40.8 v0.3
      // Wave 1) is a per-route attribute container — it carries
      // `db=`/`auth=`/`csrf=`/`ratelimit=` for the inferred route, but it
      // does NOT correspond to a DOM element. Emit its children transparently
      // (same shape as the unnamed `<program>` above). Prior to this change
      // emit-html left the literal `<page>` tag in output HTML, which the
      // browser ignored but cluttered the rendered DOM.
      if (tag === "page") {
        // ss15 item-2 (S214) -- <page> body is a DEFAULT-LOGIC root (§40.8),
        // same as <program>. Push its tag so bare-expr children are effects.
        markupParentStack.push(tag);
        for (const child of children) {
          emitNode(child);
        }
        markupParentStack.pop();
        return;
      }

      if (LIFECYCLE_SILENT_TAGS.has(tag)) {
        const span = node.span ?? { file: "", start: 0, end: 0, line: 1, col: 1 };
        const attrMap = new Map<string, any>((attrs ?? []).map((a: any) => [a.name, a]));

        if (!attrMap.has("interval")) {
          if (errors) {
            errors.push(new CGError(
              "E-LIFECYCLE-009",
              `E-LIFECYCLE-009: \`<${tag}>\` is missing the required \`interval\` attribute. ` +
              `The interval specifies how often the body executes, in milliseconds. ` +
              `Example: \`<${tag} interval=1000>\`.`,
              span,
            ));
          }
        } else {
          const intervalAttr = attrMap.get("interval");
          const intervalVal = intervalAttr?.value;
          let intervalMs: number | null = null;
          if (intervalVal?.kind === "string-literal") {
            intervalMs = parseInt(intervalVal.value, 10);
          } else if (intervalVal?.kind === "variable-ref") {
            const raw: string = intervalVal.name ?? "";
            intervalMs = parseInt(raw, 10);
          }
          if (intervalMs !== null && !isNaN(intervalMs) && intervalMs <= 0) {
            if (errors) {
              errors.push(new CGError(
                "E-LIFECYCLE-010",
                `E-LIFECYCLE-010: \`<${tag}>\` has \`interval=${intervalMs}\` which is zero or negative. ` +
                `The interval must be a positive integer (milliseconds). ` +
                `Example: \`interval=1000\` for 1 second.`,
                span,
              ));
            }
          }
        }

        if (attrMap.has("running")) {
          const runningAttr = attrMap.get("running");
          const runningVal = runningAttr?.value;
          if (runningVal?.kind === "variable-ref" && runningVal.name === "false") {
            if (errors) {
              errors.push(new CGError(
                "W-LIFECYCLE-007",
                `W-LIFECYCLE-007: \`<${tag}>\` has \`running=false\` as a boolean literal. ` +
                `This timer starts paused and has no way to resume without a reactive \`@variable\`. ` +
                `Use \`running=@yourVar\` to make the running state reactive, or remove the attribute to always run.`,
                span,
                "warning",
              ));
            }
          }
        }

        if (tag === "timer") {
          if (isSelfClosing || children.length === 0) {
            if (errors) {
              errors.push(new CGError(
                "W-LIFECYCLE-002",
                `W-LIFECYCLE-002: \`<timer>\` has no body and no observable effect. ` +
                `A timer with no logic body only increments tickCount. ` +
                `If you need tick counting, add a \`${"\${"}<#id>.tickCount = <#id>.tickCount + 1}\` body, ` +
                `or remove this timer.`,
                span,
                "warning",
              ));
            }
          }
        }

        if (tag === "poll") {
          if (isSelfClosing || children.length === 0) {
            if (errors) {
              errors.push(new CGError(
                "E-LIFECYCLE-012",
                `E-LIFECYCLE-012: \`<poll>\` requires a logic body. ` +
                `A poll that fetches nothing is nonsensical. ` +
                `Add a \`\${ @data = fetchSomething() }\` body.`,
                span,
              ));
            }
          }
        }

        return;
      }

      if (INPUT_STATE_TAGS.has(tag)) {
        const span = node.span ?? { file: "", start: 0, end: 0, line: 1, col: 1 };
        const attrMap = new Map<string, any>((attrs ?? []).map((a: any) => [a.name, a]));

        if (!attrMap.has("id")) {
          const errCodes: Record<string, string> = { keyboard: "E-INPUT-001", mouse: "E-INPUT-002", gamepad: "E-INPUT-003" };
          const code = errCodes[tag] ?? "E-INPUT-001";
          if (errors) {
            errors.push(new CGError(
              code,
              `${code}: \`<${tag}>\` requires an \`id\` attribute. Without an id, the ` +
              `input state cannot be referenced via \`<#id>\`. ` +
              `Add \`id="yourName"\` to the element.`,
              span,
            ));
          }
        }

        if (tag === "gamepad" && attrMap.has("index")) {
          const indexAttr = attrMap.get("index");
          const indexVal = indexAttr?.value;
          let indexNum: number | null = null;
          if (indexVal?.kind === "string-literal") {
            indexNum = parseInt(indexVal.value, 10);
          } else if (indexVal?.kind === "variable-ref") {
            indexNum = parseInt((indexVal.name ?? "").replace(/^@/, ""), 10);
          }
          if (indexNum !== null && !isNaN(indexNum) && (indexNum < 0 || indexNum > 3)) {
            if (errors) {
              errors.push(new CGError(
                "E-INPUT-004",
                `E-INPUT-004: \`<gamepad>\` attribute \`index\` must be 0, 1, 2, or 3 ` +
                `(the Gamepad API supports at most 4 simultaneous gamepads). ` +
                `Got \`${indexNum}\`. Use a value in [0, 1, 2, 3].`,
                span,
              ));
            }
          }
        }

        return;
      }

      if (REQUEST_TAGS.has(tag)) {
        const span = node.span ?? { file: "", start: 0, end: 0, line: 1, col: 1 };
        const attrMap = new Map<string, any>((attrs ?? []).map((a: any) => [a.name, a]));

        if (!attrMap.has("id")) {
          if (errors) {
            errors.push(new CGError(
              "E-LIFECYCLE-018",
              `E-LIFECYCLE-018: \`<request>\` requires an \`id\` attribute. Without an id, ` +
              `the fetch state cannot be referenced via \`<#id>.loading\`, \`<#id>.data\`, etc. ` +
              `Add \`id="yourName"\` to the element.`,
              span,
            ));
          }
        }

        return;
      }

      if (TIMEOUT_TAGS.has(tag)) {
        const span = node.span ?? { file: "", start: 0, end: 0, line: 1, col: 1 };
        const attrMap = new Map<string, any>((attrs ?? []).map((a: any) => [a.name, a]));

        if (!attrMap.has("delay")) {
          if (errors) {
            errors.push(new CGError(
              "E-TIMEOUT-001",
              `E-TIMEOUT-001: \`<timeout>\` requires a \`delay\` attribute. ` +
              `The delay specifies when the timeout fires, in milliseconds. ` +
              `Example: \`<timeout id="guard" delay=5000>\`.`,
              span,
            ));
          }
        } else {
          const delayAttr = attrMap.get("delay");
          const delayVal = delayAttr?.value;
          let delayMs: number | null = null;
          if (delayVal?.kind === "string-literal") {
            delayMs = parseInt(delayVal.value, 10);
          } else if (delayVal?.kind === "variable-ref") {
            const raw: string = (delayVal.name ?? "").replace(/^@/, "");
            delayMs = parseInt(raw, 10);
          }
          if (delayMs !== null && !isNaN(delayMs) && delayMs <= 0) {
            if (errors) {
              errors.push(new CGError(
                "E-TIMEOUT-002",
                `E-TIMEOUT-002: \`<timeout>\` has \`delay=${delayMs}\` which is zero or negative. ` +
                `The delay must be a positive integer (milliseconds). ` +
                `Example: \`delay=5000\` for 5 seconds.`,
                span,
              ));
            }
          }
        }

        return;
      }

      if (tag === "channel") {
        const span = node.span ?? { file: "", start: 0, end: 0, line: 1, col: 1 };
        const attrMap = new Map<string, any>((attrs ?? []).map((a: any) => [a.name, a]));
        if (!attrMap.has("name")) {
          if (errors) {
            errors.push(new CGError(
              "E-CHANNEL-001",
              `E-CHANNEL-001: \`<channel>\` is missing the required \`name\` attribute. ` +
              `The name identifies this channel and sets the WebSocket URL path. ` +
              `Example: \`<channel name="chat">\`.`,
              span,
            ));
          }
        }
        return;
      }

      // Pre-pass: validate bind: attributes
      if (errors) {
        for (const attr of attrs) {
          if (!attr || !attr.name) continue;
          if (!attr.name.startsWith("bind:")) continue;

          const bindName: string = attr.name;
          const suffix: string = bindName.slice(5);
          const span = attr.span ?? node.span ?? { file: "", start: 0, end: 0, line: 0, col: 0 };

          if (!SUPPORTED_BIND_NAMES.has(suffix)) {
            errors.push(new CGError(
              "E-ATTR-011",
              `E-ATTR-011: \`${bindName}\` is not a supported bind: attribute. ` +
              `Supported: \`bind:value\`, \`bind:checked\`, \`bind:selected\`, \`bind:group\`, \`bind:this\`.`,
              span,
            ));
          }

          const val = attr.value;
          const isReactive: boolean = val && val.kind === "variable-ref" &&
            (val.name ?? "").startsWith("@");
          if (!isReactive && SUPPORTED_BIND_NAMES.has(suffix)) {
            const rawName: string | null = val && val.kind === "variable-ref"
              ? val.name
              : (val && val.kind === "string-literal" ? val.value : null);
            const hint = rawName
              ? ` \`${rawName}\` is not reactive. Use \`@${rawName}\` or change \`${bindName}\` to \`${suffix}=${rawName}\`.`
              : ` The right-hand side of \`${bindName}\` must be an \`@\`-prefixed reactive variable, e.g. \`bind:value=@myVar\`.`;
            errors.push(new CGError(
              "E-ATTR-010",
              `E-ATTR-010: \`bind:\` requires a reactive \`@\` variable.${hint}`,
              span,
            ));
          }

          if (SUPPORTED_BIND_NAMES.has(suffix)) {
            const validTags = BIND_VALID_TAGS[bindName];
            if (validTags && !validTags.has(tag)) {
              errors.push(new CGError(
                "E-ATTR-011",
                `E-ATTR-011: \`${bindName}\` is not valid on \`<${tag}>\`. ` +
                `Valid elements: ${[...validTags].map((t: string) => `<${t}>`).join(", ")}.`,
                span,
              ));
            }

            // D-FORM-8 (§5.4.1, L1651): `bind:checked` is dispatched ONLY for
            // `<input type="checkbox">`. An input carrying an EXPLICIT
            // non-checkbox type (e.g. `type="text"`) with `bind:checked` is
            // `E-ATTR-011` — otherwise the compiler silently wires `.checked` +
            // a change listener onto a text-shaped input. A bare `<input
            // bind:checked=@x>` (no `type` attr) is tolerated — the author
            // intends a checkbox and the tag check above passes (§11 unit-test
            // precedent); only an explicit conflicting type is rejected. A
            // dynamic `type=@expr` (non-string value) can't be statically
            // resolved, so it is not rejected here.
            if (bindName === "bind:checked" && tag === "input") {
              const typeAttr = attrs.find((a: any) => a && a.name === "type");
              const typeVal = typeAttr?.value?.value;
              // HTML `type` is ASCII-case-insensitive per WHATWG — `CHECKBOX`
              // renders a real checkbox, so gate case-insensitively.
              if (typeof typeVal === "string" && typeVal.toLowerCase() !== "checkbox") {
                errors.push(new CGError(
                  "E-ATTR-011",
                  `E-ATTR-011: \`bind:checked\` requires \`<input type="checkbox">\`, ` +
                  `but this element is \`<input type="${typeVal}">\`. ` +
                  `Use \`bind:value\` for text-shaped inputs, or change the type to \`checkbox\`.`,
                  span,
                ));
              }
            }
          }
        }
      }

      // Pre-scan for transition directives
      let transitionEnter: string | null = null;
      let transitionExit: string | null = null;
      for (const attr of attrs) {
        if (!attr || !attr.name) continue;
        const aName: string = attr.name;
        if (aName.startsWith("transition:")) {
          const type = aName.slice(11);
          if (SUPPORTED_TRANSITIONS.has(type)) {
            transitionEnter = type;
            transitionExit = type;
          }
        } else if (aName.startsWith("in:")) {
          const type = aName.slice(3);
          if (SUPPORTED_TRANSITIONS.has(type)) {
            transitionEnter = type;
          }
        } else if (aName.startsWith("out:")) {
          const type = aName.slice(4);
          if (SUPPORTED_TRANSITIONS.has(type)) {
            transitionExit = type;
          }
        }
      }

      // DQ-7: Pre-scan children for flat-declaration #{} blocks.
      // Flat-declaration #{} (all prop:value pairs, no selectors) compiles to
      // inline style="" on the containing element instead of an @scope CSS block.
      // Only applies to elements inside a component scope (_expandedFrom set).
      let flatInlineStyle: string | null = null;
      if (node._expandedFrom) {
        const flatParts: string[] = [];
        for (const child of children) {
          if (child && child.kind === "css-inline" && isFlatDeclarationBlock(child)) {
            // §65.3.2 / §65.4 (Task 2 [86]) — thread the theme context so a
            // flat-inline `#{ color: @brand }` lowers `@brand` → var(--brand).
            const inline = renderFlatDeclarationAsInlineStyle(child, flatInlineLowerCtx ?? undefined);
            if (inline) flatParts.push(inline);
          }
        }
        if (flatParts.length > 0) flatInlineStyle = flatParts.join(" ");
      }

      // ---------------------------------------------------------------------
      // Phase 2c (LIVE): if/show split mount/unmount path for clean subtrees.
      //
      // Per SPEC §17.1 if= is DOM existence, not visibility — the element is
      // not rendered when the condition is false. Clean-subtree if= elements
      // (lowercase tag, all attributes wiring-free, all descendants in
      // {text, comment, markup} with the same constraints recursively) compile
      // to a <template id="..."> wrapping the inner element + a
      // <!--scrml-if-marker:N--> placeholder comment. emit-event-wiring then
      // emits a controller that calls _scrml_mount_template on truthy and
      // _scrml_unmount_scope on falsy (LIFO scope teardown per §6.7.2).
      //
      // Non-clean subtrees (events, binds, transitions, components, nested
      // reactive content, expr attributes, …) fall through to the legacy
      // display-toggle path below. Phase 2d-2h will progressively widen the
      // cleanliness gate.
      //
      // Approach B1 (template + marker comment) was locked by the user in
      // S49 after a 5-phase deep-dive. Alternatives B4 (DOM-keep + scope-swap)
      // and B5 (compile-time-static-analysis + hide-on-init) eliminated on
      // §17.1 verbatim, cross-ecosystem dev expectation, stale-DOM event
      // delegation hazard, and Svelte 5 PR sveltejs/svelte#603 (separating
      // unmount from destroy) grounds. See deep-dive §3, §8, §10.
      // ---------------------------------------------------------------------
      const ifAttrCheck = attrs.find((a: any) => a.name === "if");
      if (
        ifAttrCheck &&
        ifAttrCheck.value &&
        (ifAttrCheck.value.kind === "variable-ref" || ifAttrCheck.value.kind === "expr" || ifAttrCheck.value.kind === "call-ref") &&
        !/^[A-Z]/.test(tag) &&
        attrs.every((a: any) => attrIsWiringFree(a, "if")) &&
        isCleanIfSubtree(children)
      ) {
        const ifVal = ifAttrCheck.value;
        const templateId = genVar("scrml_tpl");
        const markerId = genVar("if_marker");
        parts.push(`<template id="${templateId}">`);
        const innerNode = { ...node, attributes: attrs.filter((a: any) => a.name !== "if"), attrs: attrs.filter((a: any) => a.name !== "if") };
        emitNode(innerNode);
        parts.push(`</template>`);
        parts.push(`<!--scrml-if-marker:${markerId}-->`);
        if (registry) {
          if (ifVal.kind === "variable-ref") {
            const ifVarName = (ifVal.name ?? "").replace(/^@/, "");
            const ifBaseVar = ifVarName.split(".")[0];
            const hasDotPath = ifVarName.includes(".");
            registry.addLogicBinding({ placeholderId: markerId, expr: `@${ifVarName}`, isMountToggle: true, templateId, markerId, varName: ifBaseVar, ...(hasDotPath ? { dotPath: ifVarName } : {}) } as any);
          } else if (ifVal.kind === "call-ref") {
            // g-attr-if-fn-display-not-mount (S191): a bare-call clean-subtree
            // condition gets the SAME mount/unmount controller as if=(fn())/if=@var
            // (not the display-toggle fallback) so `if=fn()` ≡ `if=(fn())`. Build
            // a raw condExpr from the call (the fn name is mangled by the
            // whole-buffer post-pass; `_scrml_effect` dynamic-tracks the cells it
            // reads). Mirrors the call-ref attr-value branch below (~1761).
            const condRaw = `${ifVal.name}(${(ifVal.args ?? []).join(", ")})`;
            const condRefs = (ifVal.args ?? [])
              .filter((a: any) => typeof a === "string" && a.startsWith("@"))
              .map((a: any) => a.replace(/^@/, "").split(/[.[(]/)[0]);
            registry.addLogicBinding({ placeholderId: markerId, expr: condRaw, isMountToggle: true, templateId, markerId, condExpr: condRaw, refs: condRefs } as any);
          } else {
            registry.addLogicBinding({ placeholderId: markerId, expr: ifVal.raw, isMountToggle: true, templateId, markerId, condExpr: ifVal.raw, condExprNode: ifVal.exprNode, refs: ifVal.refs } as any);
          }
        }
        return;
      }

      // ---------------------------------------------------------------------
      // A1c C3 — Render-by-tag expansion (SPEC §6.4 / §5.4.1 / L17, L16).
      //
      // When a self-closing lowercase markup tag resolves to a registered
      // Shape 2 `bindable` state cell (B5 `_cellKind === "bindable"`), expand
      // the use site to the cell's `renderSpec.element` markup tree at this
      // DOM position. The expansion is identical at every use site (§6.4.4
      // forbids per-site overrides). Multi-render correctness (L16) is
      // intrinsic — the underlying reactive cell (declared by C1) is shared
      // across all expansion sites; each rendered DOM node is fresh.
      //
      // C3 emits the EXPANSION SHAPE only — the actual `bind:value` /
      // `bind:checked` / `bind:files` / `bind:group` dispatch by render-spec
      // element type is C4 (§5.4.1 dispatch table). C3 stamps a
      // `data-scrml-render-by-tag` data-attribute hookpoint that C4's wiring
      // emitter consumes (mirrors the existing `data-scrml-bind-*` /
      // `data-scrml-attr-tpl-*` placeholder conventions).
      //
      // Validators carry forward as HTML-native attributes per §6.4.2 step 4
      // (req → required, pattern → pattern, min/max → min/max, length(>=N) →
      // minlength). Validity-surface wiring (`@cell.isValid`/`.errors`) is
      // C7+ scope; not emitted here.
      //
      // B6 (symbol-table.ts:1715) has already fired E-CELL-NO-RENDER-SPEC /
      // E-CELL-RENDER-SPEC-NOT-BINDABLE on illegal use sites at A1b time,
      // so by codegen time only legal use sites survive. PascalCase tags
      // (component territory; B6 v1 accepts silently) are skipped — they
      // route through the existing component branch.
      //
      // Skip predicates: void/lifecycle/input-state/request/timeout/channel
      // tags + non-self-closed forms + uppercase-first-letter (component) +
      // tags without a render-spec resolution (HTML built-ins like <br/>).
      if (
        isSelfClosing &&
        fileScope &&
        /^[a-z]/.test(tag) &&
        !VOID_ELEMENTS.has(tag) &&
        !LIFECYCLE_SILENT_TAGS.has(tag) &&
        !INPUT_STATE_TAGS.has(tag) &&
        !REQUEST_TAGS.has(tag) &&
        !TIMEOUT_TAGS.has(tag) &&
        tag !== "channel" &&
        tag !== "errorBoundary" && tag !== "errorboundary" &&
        tag !== "program"
      ) {
        // Bug 60 (S157) — resolve the tag to its cell record. Bare lookup first
        // (top-level Shape-2 cell); if that fails AND we're inside a compound-
        // parent wrapper (`enclosingCompoundStack`), descend into the compound
        // sub-scope via lookupQualifiedStateCell so a NESTED field self-tag
        // (`<userName/>` inside `<signupForm>...</>`) resolves to its qualified
        // leaf record (`signupForm.userName`) — SPEC §6.3.5:2209 + §6.4.2. The
        // bind key (`cellNameForBind`) is the record's `qualifiedPath`, which is
        // `tag` for top-level cells and the dotted path for nested fields; the
        // C4 wiring keys `_scrml_reactive_get/set` on it (emit-bindings.ts:697),
        // matching the §55 flat dotted runtime cell already emitted by SYM.
        let decl = lookupStateCell(fileScope, tag);
        if (!decl && enclosingCompoundStack.length > 0) {
          const enclosing = enclosingCompoundStack[enclosingCompoundStack.length - 1];
          decl = lookupQualifiedStateCell(fileScope, [enclosing, tag]);
        }
        // g-compound-field-render-by-tag-unexpanded — a compound MEMBER's
        // render-by-tag (`<uname/>`) used OUTSIDE the compound's lexical block
        // body (e.g. in a sibling `<form>`) has no `enclosingCompoundStack`
        // entry to qualify with, so the two lookups above both miss and the tag
        // was silently emitted as a literal element. Per SPEC §6.3.5:2290 +
        // §6.4.2 the member `<uname/>` SHALL expand to its bound input wherever
        // it is referenced. Scan every compound parent in scope for a member
        // whose leaf name matches `tag`; resolve when exactly one matches.
        if (!decl) {
          const memberMatches = lookupCompoundMembersByLeafName(fileScope, tag);
          if (memberMatches.length === 1) {
            decl = memberMatches[0];
          } else if (memberMatches.length > 1) {
            // §6.4 forbids a silent pick: when the same member name lives in
            // more than one in-scope compound, the bare `<tag/>` reference is
            // ambiguous. Surface a diagnostic and leave the tag unexpanded
            // (the literal-tag fall-through below) rather than guess.
            const span = node.span ?? { file: "", start: 0, end: 0, line: 1, col: 1 };
            const candidatePaths = memberMatches
              .map((m) => `@${m.qualifiedPath}`)
              .join(", ");
            if (errors) errors.push(new CGError(
              "E-CELL-AMBIGUOUS-MEMBER-RENDER",
              `E-CELL-AMBIGUOUS-MEMBER-RENDER: render-by-tag \`<${tag}/>\` is ambiguous — ` +
              `the member name \`${tag}\` is declared in more than one in-scope compound ` +
              `(${candidatePaths}). A bare member \`<${tag}/>\` reference cannot pick one. ` +
              `Disambiguate by referencing the field through its compound, e.g. render the ` +
              `field inside its compound's block body \`<compound><${tag}/></>\`, or rename ` +
              `the colliding members. See SPEC §6.3.5 / §6.4.`,
              span,
            ));
          }
        }
        const cellKind = decl ? getCellKind(decl.declNode as any) : undefined;
        if (decl && cellKind === "bindable") {
          const cellNameForBind: string = decl.qualifiedPath ?? tag;
          const renderSpecRoot: any = (decl.declNode as any).renderSpec?.element;
          if (renderSpecRoot && renderSpecRoot.kind === "markup") {
            const renderById = genVar("render_by_tag");

            // Collect the renderSpec's existing attributes (decl-site authoritative).
            const baseAttrs: any[] = renderSpecRoot.attributes ?? renderSpecRoot.attrs ?? [];

            // Lower HTML-native validators to attributes per §6.4.2 step 4.
            const validatorAttrs = _validatorAttrsForCell(decl.declNode as any);

            // Hookpoint attribute for C4's bind:* dispatch.
            const renderByTagAttr = {
              name: "data-scrml-render-by-tag",
              value: { kind: "string-literal", value: renderById },
            };

            // Build the expanded markup node — clone the renderSpec.element
            // shallowly with the augmented attribute list. Don't mutate the
            // source AST; downstream walkers may revisit.
            const expanded = {
              ...renderSpecRoot,
              attributes: [...baseAttrs, ...validatorAttrs, renderByTagAttr],
              attrs: undefined,
            };

            // Emit via the regular markup walker — recurses through children,
            // attaches data-scrml-bind-*/-class:/-on*/etc placeholders for
            // any reactive attributes the renderSpec already carries, and
            // honours all the standard attribute-emission paths.
            emitNode(expanded);

            // Record the binding for C4 + downstream consumers.
            if (registry) {
              registry.addLogicBinding({
                kind: "render-by-tag",
                placeholderId: renderById,
                cellName: cellNameForBind,
                renderSpecTag: renderSpecRoot.tag,
                renderSpecAttrs: baseAttrs,
                declValidators: (decl.declNode as any).validators ?? [],
              } as any);
            }
            return;
          }
        }
      }

      parts.push(`<${tag}`);

      if (node._expandedFrom) {
        // DQ-7: data-scrml="Name" is the @scope root attribute (native CSS @scope).
        // Replaces prior data-scrml-scope="Name" attribute.
        parts.push(` data-scrml="${escapeHtmlAttr(node._expandedFrom)}"`);
      }

      // DQ-7: inject flat-declaration #{} content as inline style=""
      if (flatInlineStyle) {
        parts.push(` style="${escapeHtmlAttr(flatInlineStyle)}"`);
      }

      // ---------------------------------------------------------------------
      // A1c C16 — §53.7.1 Pre-pass: derive HTML validation attributes from
      // refinement-type predicates on bind:value-bound cells.
      //
      // For each `bind:value=@var` attribute, look up @var's typeAnnotation
      // in `reactiveTypeMap`; if it parses as a predicated type (§53.2),
      // derive the HTML attrs (min/max/minlength/maxlength/type/required/
      // pattern) per §53.7.1 mapping. Track them in `derivedRefinementAttrs`
      // for emission alongside developer attrs (with conflict detection).
      //
      // §53.7.3 — when a developer-supplied attr conflicts with a derived
      // attr, emit E-CONTRACT-004-WARN; the shape-derived value takes
      // precedence in the compiled output.
      // ---------------------------------------------------------------------
      const derivedRefinementAttrs: Map<string, string> = new Map();
      const refinementSourceVar: Map<string, string> = new Map(); // attr-name → var-name (for warning messages)
      const refinementSourcePred: Map<string, string> = new Map(); // attr-name → predicate-display (for warning messages)
      for (const _bvAttr of attrs) {
        if (!_bvAttr || _bvAttr.name !== "bind:value") continue;
        const _bvVal = _bvAttr.value;
        if (!_bvVal || _bvVal.kind !== "variable-ref") continue;
        const _bvName = (_bvVal.name ?? "").replace(/^@/, "");
        // Resolve top-level cell name (for `@user.email` use the leaf).
        // For root-cell references like `@username` we look up "username".
        const _bvRootKey = _bvName.split(".")[0];
        const _bvAnnot = reactiveTypeMap.get(_bvRootKey);
        if (!_bvAnnot) continue;
        const _bvParsed = parsePredicateAnnotation(_bvAnnot);
        if (!_bvParsed) continue;
        const _bvDerived = deriveHtmlAttrs(_bvParsed.predicate, _bvParsed.baseType);
        for (const [k, v] of Object.entries(_bvDerived)) {
          // First derived value wins when multiple bind:value cover the same attr
          // (rare; bind:value is typically one-per-element).
          if (!derivedRefinementAttrs.has(k)) {
            derivedRefinementAttrs.set(k, v);
            refinementSourceVar.set(k, _bvRootKey);
            refinementSourcePred.set(k, _bvAnnot);
          }
        }
      }

      // §53.7.3 — Track which developer-supplied attrs conflict with derived
      // ones so we can SKIP emitting the developer value (shape-derived
      // precedence) AND emit E-CONTRACT-004-WARN.
      const skipDeveloperAttrs: Set<any> = new Set();
      if (derivedRefinementAttrs.size > 0) {
        for (const _devAttr of attrs) {
          if (!_devAttr) continue;
          const _devName: string = _devAttr.name;
          if (!derivedRefinementAttrs.has(_devName)) continue;
          // Compare developer-supplied value against the derived value.
          const _devVal = _devAttr.value;
          const _devValStr = (_devVal && _devVal.kind === "string-literal") ? _devVal.value : null;
          // If devVal is `absent` (boolean attribute like `required`), treat as "" — same
          // as `required="" `. Conflict only when developer value differs from derived.
          const _devEffective = _devVal && _devVal.kind === "absent" ? "" : _devValStr;
          const _derivedVal = derivedRefinementAttrs.get(_devName);
          if (_devEffective === null) {
            // Developer value is reactive/expression/etc — can't statically
            // compare. Skip the derived attr (developer takes precedence for
            // dynamic attrs to avoid runtime confusion). No warning.
            derivedRefinementAttrs.delete(_devName);
            continue;
          }
          if (_devEffective !== _derivedVal) {
            // Conflict — §53.11 E-CONTRACT-004-WARN. Shape-derived takes precedence.
            const _src = refinementSourceVar.get(_devName) ?? "";
            const _pred = refinementSourcePred.get(_devName) ?? "";
            if (errors) {
              errors.push(new CGError(
                "E-CONTRACT-004-WARN",
                `E-CONTRACT-004-WARN: bind:value attribute conflict.\n` +
                `  Element:        <${tag}>\n` +
                `  Declared:       ${_devName}="${_devEffective}"\n` +
                `  Shape-derived:  ${_devName}="${_derivedVal}" (from ${_pred} on @${_src})\n\n` +
                `  The shape-derived attribute will override the declared attribute in compiled output.\n` +
                `  Remove the explicit ${_devName}= attribute to eliminate this warning.`,
                _devAttr.span ?? node.span ?? { file: "", start: 0, end: 0, line: 0, col: 0 },
                "warning",
              ));
            }
            // Mark dev attr as skip so the derived value is emitted instead.
            skipDeveloperAttrs.add(_devAttr);
          } else {
            // No conflict — dev value matches derived. Suppress duplicate emission
            // (the existing dev attr will emit; remove from derived set).
            derivedRefinementAttrs.delete(_devName);
          }
        }
      }

      for (const attr of attrs) {
        if (!attr) continue;
        const name: string = attr.name;
        const val = attr.value;

        if (name.startsWith("transition:") || name.startsWith("in:") || name.startsWith("out:")) {
          continue;
        }

        // §53.7.3: developer attr conflicts with shape-derived → suppress dev,
        // shape-derived is emitted in the post-loop block below.
        if (skipDeveloperAttrs.has(attr)) continue;

        if (name.startsWith("bind:")) {
          const bindId = genVar(`bind_${name.replace(":", "_")}`);
          parts.push(` data-scrml-${name.replace(":", "-")}="${bindId}"`);
          if (!attr._bindId) attr._bindId = bindId;
          // Family-A convergence (HALF 1) — when this bind: directive sits inside
          // a `<match>` arm / `<engine>` state-child body, the top-level
          // emit-bindings.ts pass (which walks collectMarkupNodes) never reaches
          // it, so the `querySelector + addEventListener + _scrml_effect` wiring is
          // never emitted (typed input silently dropped:
          // g-bindvalue-wiring-dropped-in-match-arm, HIGH). Register an arm-tagged
          // bind-directive binding so emit-variant-guard.ts:emitArmWireFunction
          // re-emits the bind wiring per-mount against the arm `_root` via the
          // shared emitBindDirectiveBody helper. Mirrors the S212 class:/attr-tpl
          // registration just below. The top-level path is unchanged (it walks the
          // markup AST directly; this binding is consumed ONLY by the arm wire fn).
          if (
            registry && registry.currentArmContext != null &&
            attr.value && attr.value.kind === "variable-ref"
          ) {
            registry.addLogicBinding({
              kind: "bind-directive",
              bindAttr: attr,
              bindNode: node,
              // Capture the LOCAL bindId that was just emitted into the arm-body
              // HTML (`parts.push`). The engine path renders a state-child body
              // through generateHtml MORE THAN ONCE (static initial-mount HTML +
              // the arm render fn), and each pass mints a fresh `genVar` bindId.
              // `attr._bindId` is sticky from the FIRST render, so re-deriving the
              // selector from it in emitArmWireFunction would point at a DIFFERENT
              // id than the one in the HTML this binding was registered alongside.
              // Pinning the per-render `bindId` here keeps the wire fn's selector
              // in lockstep with its own arm-render HTML (mirrors how the S212
              // class:/attr-tpl path captures `directiveSelector` at reg time).
              bindIdForArm: bindId,
            });
          }
          continue;
        }

        if (name.startsWith("class:")) {
          const classBindId = genVar(`class_${name.replace(":", "_")}`);
          const classDataAttr = `data-scrml-${name.replace(":", "-")}`;
          parts.push(` ${classDataAttr}="${classBindId}"`);
          if (!attr._bindId) attr._bindId = classBindId;
          // g-match-arm-reactive-attr-effects (S212) — when this class: directive
          // sits inside a `<match>` arm body, the top-level emit-bindings.ts pass
          // (which walks collectMarkupNodes) never reaches it, so its `_scrml_effect`
          // is never wired. Register an arm-tagged class-directive binding so
          // emit-variant-guard.ts:emitArmWireFunction re-emits the toggle + effect
          // per-mount against the arm `_root`. The top-level path is unchanged.
          if (registry && registry.currentArmContext != null && liveCtx) {
            const lowered = lowerClassDirectiveCondition(val as any, {
              derivedNames: liveCtx.derivedNames,
              synthCellKeys: liveCtx.synthCellKeys,
            });
            if (lowered) {
              registry.addLogicBinding({
                kind: "class-directive",
                directiveSelector: `[${classDataAttr}="${classBindId}"]`,
                className: name.slice("class:".length),
                directiveJsExpr: lowered.jsExpr,
                directiveRefs: lowered.refs,
              });
            }
          }
          continue;
        }

        if (name === "ref" && val && val.kind === "variable-ref") {
          const refName: string = val.name.replace(/^@/, "");
          parts.push(` data-scrml-ref="${escapeHtmlAttr(refName)}"`);
          continue;
        }

        if (!val || val.kind === "absent") {
          parts.push(` ${name}`);
        } else if (val.kind === "string-literal") {
          if (hasTemplateInterpolation(val.value)) {
            const tplId = genVar(`attr_tpl_${name}`);
            parts.push(` ${name}="" data-scrml-attr-tpl-${name}="${tplId}"`);
            if (!attr._tplId) attr._tplId = tplId;
            // g-match-arm-reactive-attr-effects (S212) — same gap as class:.
            // A reactive `style="...${@x}..."` (or any interpolated attr value)
            // inside a `<match>` arm body gets its `data-scrml-attr-tpl-*`
            // placeholder but no `_scrml_effect`. Register an arm-tagged
            // attr-template binding so emitArmWireFunction wires it per-mount.
            if (registry && registry.currentArmContext != null) {
              const lowered = lowerAttrTemplateValue(String(val.value ?? ""));
              registry.addLogicBinding({
                kind: "attr-template",
                directiveSelector: `[data-scrml-attr-tpl-${name}="${tplId}"]`,
                attrName: name,
                directiveJsExpr: lowered.jsExpr,
                directiveRefs: lowered.refs,
              });
            }
          } else {
            parts.push(` ${name}="${escapeHtmlAttr(val.value)}"`);
          }
        } else if (val.kind === "variable-ref") {
          const varName: string = val.name ?? "";
          if (varName.startsWith("@") && (name === "if" || name === "show")) {
            // §17.1 / §17.2: if=@var / show=@var — reactive conditional binding.
            // The @-prefix marks the variable as reactive.
            // if=  → mount/unmount semantics (Phase 2 work; today: display-toggle)
            // show= → display-toggle semantics (Vue v-show)
            const placeholderId = genVar(`attr_${name}`);
            const dataAttr = name === "show" ? "data-scrml-bind-show" : "data-scrml-bind-if";
            parts.push(` ${dataAttr}="${placeholderId}"`);
            if (registry) {
              const ifVarName = varName.replace(/^@/, "");
              const ifBaseVar = ifVarName.split(".")[0];
              const hasDotPath = ifVarName.includes(".");
              registry.addLogicBinding({
                placeholderId,
                expr: `@${ifVarName}`,
                ...(name === "show" ? { isVisibilityToggle: true } : { isConditionalDisplay: true }),
                varName: ifBaseVar,
                ...(hasDotPath ? { dotPath: ifVarName } : {}),
                ...(transitionEnter ? { transitionEnter } : {}),
                ...(transitionExit ? { transitionExit } : {}),
              });
            }
          } else if (name.startsWith("on") && !varName.startsWith("@") && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(varName)) {
            // §5.2.2 row 5 (bare-ref form) — `onclick=handler` (no parens, no
            // `${...}`). The attr-value parser produces a `variable-ref` for a
            // bare identifier; the SOURCE name (e.g. `bump`) is the declared
            // handler. Per SPEC §5.2.2: "wire `handler` directly as the event
            // listener without wrapping." Route to event wiring (NOT literal
            // attribute emission, which referenced a nonexistent global and left
            // the handler dead). The `bareRefHandler` flag tells emit-event-wiring
            // to resolve `handlerName` through fnNameMap to `_scrml_<name>_N` and
            // wire that reference DIRECTLY (no `function(event){ fn(); }` wrap —
            // that is the OTHER, call-ref `fn()` form). Mirrors the call-ref
            // routing below; the wired listener receives the DOM event as its arg.
            const placeholderId = genVar(`attr_${name}`);
            parts.push(` data-scrml-bind-${name}="${placeholderId}"`);
            if (registry) {
              registry.addEventBinding({
                placeholderId,
                eventName: name,
                handlerName: varName,
                handlerArgs: [],
                bareRefHandler: true,
              });
            }
          } else if (varName.startsWith("@") && REACTIVE_BOOL_ATTRS.has(name)) {
            // i29-D — bare `disabled=@saving` (a reactive Boolean attribute
            // assigned a bare `@var`). WITHOUT this clause it fell through to
            // the general `else` below and emitted a STATIC `disabled="saving"`
            // (always-on, no reactivity). Route it into the SAME reactive
            // bool-binding the `val.kind === "expr"` branch uses (`disabled=!@x`)
            // — identical `data-scrml-bind-bool-<name>` placeholder + effect.
            // The bare `@var` is the reactive source: pass its raw `@`-prefixed
            // text as the condition (no exprNode); emit-event-wiring's
            // emitExprField lowers it via rewriteExprWithDerived. `refs` carries
            // the base cell name (dotted paths subscribe on their root cell).
            //
            // SCOPE (held-#81 boundary): this clause is REACTIVE_BOOL_ATTRS-only
            // (disabled/readonly/required — existing single-writer machinery, no
            // ownership question). Bare `value=@var` / class / style / title /
            // data-* still fall to the static `else` below — that is #81's
            // value-attribute territory, blocked on the writer-ownership ruling.
            // Do not widen this to a general "bind any bare @var attr" fix.
            const boolVarName = varName.replace(/^@/, "");
            const boolBaseVar = boolVarName.split(/[.[(]/)[0];
            emitReactiveBoolAttr(name, parts, registry, {
              rawExpr: `@${boolVarName}`,
              refs: boolBaseVar ? [boolBaseVar] : [],
            });
          } else {
            // General attribute: strip optional @ prefix so show=@count
            // resolves identically to show=count (allow-atvar-in-attrs).
            const resolved = varName.replace(/^@/, "");
            parts.push(` ${name}="${escapeHtmlAttr(resolved)}"`);
          }
        } else if (val.kind === "expr") {
          if (name === "if" || name === "show") {
            const placeholderId = genVar(`attr_${name}`);
            const dataAttr = name === "show" ? "data-scrml-bind-show" : "data-scrml-bind-if";
            parts.push(` ${dataAttr}="${placeholderId}"`);
            if (registry) {
              registry.addLogicBinding({
                placeholderId,
                expr: val.raw,
                ...(name === "show" ? { isVisibilityToggle: true } : { isConditionalDisplay: true }),
                condExpr: val.raw,
                condExprNode: val.exprNode,
                refs: val.refs,
                ...(transitionEnter ? { transitionEnter } : {}),
                ...(transitionExit ? { transitionExit } : {}),
              });
            }
          } else if (name.startsWith("on")) {
            // Event attribute with ${...} expression value, e.g. onclick=${() => fn(arg)}
            const placeholderId = genVar(`attr_${name}`);
            parts.push(` data-scrml-bind-${name}="${placeholderId}"`);
            if (registry) {
              registry.addEventBinding({
                placeholderId,
                eventName: name,
                handlerName: "",
                handlerArgs: [],
                handlerExpr: val.raw,
                handlerExprNode: val.exprNode,
              });
            }
          } else if (REACTIVE_BOOL_ATTRS.has(name)) {
            // S105 B1 — reactive Boolean HTML attribute (disabled, readonly,
            // required). Closes §41.14 formFor follow-on (`disabled=!@form.isValid`
            // on the default submit button) and unlocks general adopter use of
            // `<input disabled=${@busy}>`, etc.
            //
            // The runtime path wires an `_scrml_effect` that toggles attribute
            // presence (`setAttribute(name, "")` on truthy / `removeAttribute(name)`
            // on falsy) — mirrors the if/show display-toggle structure.
            emitReactiveBoolAttr(name, parts, registry, {
              rawExpr: val.raw,
              exprNode: val.exprNode,
              refs: val.refs,
            });
          } else if (
            !valueAttrElementIsLowerable(node, tag) ||
            isDeclaredPropAttr(node, name) ||
            isUserComponentMarkup(node) ||
            HTML_BOOLEAN_ATTRS.has(name) ||
            !valueAttrIsLowerable(val, name, attrs, tag, attr, node, errors)
          ) {
            // i81 — NOT a lowerable value attribute. Emit NOTHING, preserving
            // the exact pre-i81 behavior (silent drop). EVERY clause here was
            // forced by a REAL regression found by recompiling the corpus (R26);
            // the unit suite was 100% green through all of them.
            //
            // The markup attribute namespace is shared by three different things
            // that all reach this emitter, and only the first is a DOM attribute:
            //   a. real HTML attrs           `<div class=(@m)>`
            //   b. scrml DIRECTIVE attrs     `<tableFor pick=[...]>`  (NOT DOM)
            //   c. component call-site props `<List row={...}/>`      (NOT DOM)
            //
            // 1. resolvedKind must be "html-builtin" (a real element) or null.
            //    `resolvedKind` is the NR-authoritative routing signal: NR
            //    (Stage 3.05) stamps it, downstream stages READ it, and the
            //    legacy component boolean survives only as a derived backcompat
            //    field — routing on it directly is asserted against by the
            //    P3-FOLLOW migration-invariant test, which caught an earlier cut
            //    of this guard. Measured: `<button class=(...)>` is
            //    "html-builtin"; `<tableFor>`/`<formFor>` are "unknown" (they are
            //    scrml directives — dev-1-react.scrml emitted a bogus `pick` DOM
            //    binding before this clause).
            //
            //    `null` is admitted because a <match> ARM body is not NR-stamped,
            //    and a dynamic `class=` inside an arm is idiomatic. That makes
            //    null ambiguous on its own, hence clause 2.
            //
            // 2. `_expandedFrom` — the component-expander's stamp on an EXPANDED
            //    component root. Expansion runs BEFORE codegen and merges
            //    call-site props onto that root, so the TAG is useless as a
            //    discriminator (emit-html sees `div`, not `List`) and its
            //    resolvedKind is null — indistinguishable from an arm body
            //    WITHOUT this stamp. snippet-002-parametric.scrml lowered a
            //    parametric-snippet lambda to `const _scrml_v = ((item) =>
            //    <span>...` — markup spliced into JS => E-CODEGEN-INVALID-LOGIC.
            //
            // 3. `isUserComponentMarkup` — the sanctioned NR-prefer-with-fallback
            //    component predicate (covers the resolvedKind == null + legacy
            //    component-boolean backcompat case that clause 1 would admit).
            //
            // 4. `HTML_BOOLEAN_ATTRS` — a boolean attribute carries meaning by
            //    PRESENCE, so `setAttribute("checked", "false")` still renders
            //    CHECKED. 27-type-derived-table.scrml: `<input checked=(@a && @b)>`
            //    began emitting exactly that — a permanently-checked checkbox.
            //    These stay dropped rather than newly-WRONG. REACTIVE_BOOL_ATTRS
            //    is deliberately NOT widened to cover them: bool and value are
            //    different lowerings, and that promotion is a separate decision.
            //
            // Conservative by construction: every clause preserves the pre-i81
            // drop, so none can regress a shape that works today. Known costs,
            // all pre-existing and recorded as follow-ups rather than silently
            // widened: an SVG child (`<use xlink:href=(@h)/>`, resolvedKind
            // "unknown"), a value attr on a component call site
            // (`<Card class=(@x)/>`), and boolean attrs beyond the
            // REACTIVE_BOOL_ATTRS trio all remain dropped.
          } else if (analyzeWriterConflict(attrs, name, tag)) {
            // i81 Axiom ① — this reactive value attribute is a WHOLESALE writer
            // of a DOM surface that ANOTHER writer also targets on the same
            // element (bryan's #81 ruling: exclusive wholesale-owner per
            // surface). Emitting it would silently erase the composer's work on
            // the next reactive update (`class=(expr)` erases a `class:` toggle;
            // `style=(expr)` wipes the `display` a `show=` writes). So this is a
            // COMPILE ERROR (`E-ATTR-WRITER-CONFLICT`) naming both sites — the
            // author picks one owner. Emit NOTHING so the artifact stays
            // byte-identical to pre-i81: a program that ignores the error keeps
            // the old (dropped) behavior, not a broken one.
            //
            // Re-fetch the descriptor (the `else if` proved it non-null): the
            // analysis is a pure scan over a handful of sibling attrs, so a
            // second call is cheap and keeps the emit body below un-nested.
            const _conflict = analyzeWriterConflict(attrs, name, tag)!;
            if (errors) {
              const _competitors = _conflict.competitors
                .map((c) => `\`${c}=\``)
                .join(", ");
              const _plural = _conflict.competitors.length !== 1;
              const _surfaceLabel =
                _conflict.surface === "value"
                  ? "the `value` property"
                  : "the whole `" + _conflict.surface + "` attribute";
              const _pick =
                name === "class"
                  ? `    - keep \`class=(…)\` and fold the toggles into the expression ` +
                    `(e.g. \`class=(@active ? "tab active" : "tab")\`), or\n` +
                    `    - drop \`class=(…)\` and use \`class:\`/transitions for every class.`
                  : name === "style"
                  ? `    - keep \`style=(…)\` and drive visibility from inside it, or\n` +
                    `    - drop \`style=(…)\` and move the dynamic styling to \`class=\`/\`class:\` ` +
                    `(which composes with \`if=\`/\`show=\`/transitions).`
                  : `    - use \`value=(…)\` alone, or \`bind:value\` alone — not both.`;
              errors.push(new CGError(
                "E-ATTR-WRITER-CONFLICT",
                `E-ATTR-WRITER-CONFLICT: \`${name}=\` on <${tag}> is a WHOLESALE writer of ` +
                `${_surfaceLabel} — it replaces the whole surface on every reactive update. ` +
                `But ${_competitors} on the same element also ${_plural ? "write" : "writes"} ` +
                `\`${_conflict.surface}\`, and the next \`${name}=\` update would silently erase ` +
                `${_plural ? "their" : "its"} work.\n\n` +
                `  Axiom ①: each physical DOM surface (className / style / value / each attribute) ` +
                `has at most one WHOLESALE owner. Pick one:\n${_pick}\n` +
                `  (SPEC §5.5.3, §5.5.4, §34.)`,
                attr?.span ?? node?.span ?? { file: "", start: 0, end: 0, line: 0, col: 0 },
                "error",
              ));
            }
          } else {
            // i81 — reactive VALUE attribute (`class=`, `style=`, `title=`,
            // `data-*`, `id=`, `alt=`, …). THE MISSING FINAL `else`, and the
            // SOLE wholesale owner of its surface (Axiom ①: the conflict branch
            // above already diverted any surface with a competing writer).
            //
            // Before this branch existed the chain above ended here, so a
            // dynamic value attribute outside `<each>` matched NO branch:
            // nothing was pushed to `parts` and the attribute vanished from the
            // emitted HTML — silently, on a clean compile with 0 diagnostics
            // (the CSS written against those classes then read as dead code).
            // Inside `<each>` it always worked, because emit-each.ts builds
            // elements imperatively and calls setAttribute directly.
            //
            // Mirrors the REACTIVE_BOOL_ATTRS block above (placeholder +
            // addLogicBinding, carrying expr/condExpr/condExprNode/refs
            // identically); the consumer is in emit-event-wiring.ts. This is a
            // DIFFERENT lowering from the bool path, not a widening of it: a
            // bool attr toggles presence on truthiness, a value attr sets a
            // string and is removed only on ABSENCE (SPEC §42.1.1 / §42.9).
            //
            // Reaching here means: an HTML element (component tags are handled
            // by the branch above) carrying a plain attribute — every special
            // family (`bind:`, `class:`, `transition:`/`in:`/`out:`, `ref`,
            // developer attrs) is peeled off with `continue` well before this
            // dispatch, and `if`/`show`/`on*`/bool by the branches above.
            const placeholderId = genVar(`attr_${name}`);
            // CSS-safe placeholder key. The name reaches the DOM verbatim via
            // `setAttribute` (SVG needs `viewBox`/`xlink:href` intact), but the
            // KEY is also interpolated into a `querySelector` attribute
            // selector, where an unescaped `:` is invalid CSS and THROWS —
            // aborting module init and every binding on the page. Sanitize the
            // key, keep the name. See LogicBinding.valueAttrKey.
            const attrKey = name.replace(/[^A-Za-z0-9_-]/g, "_");
            parts.push(` data-scrml-bind-attr-${attrKey}="${placeholderId}"`);
            if (registry) {
              registry.addLogicBinding({
                placeholderId,
                // S239 finding 10 — a value attr carries an EXPRESSION, not a
                // condition, so it uses the standard `expr`/`exprNode` pair every
                // LogicBinding has. The first cut set `expr` AND `condExpr` to the
                // same `val.raw` and `condExprNode` to the same node (copy-paste
                // from the bool block, where `cond*` is apt because it really is a
                // predicate) — redundant derivable state with two names for one
                // value, and two chances to drift.
                expr: val.raw,
                exprNode: val.exprNode,
                isReactiveValueAttr: true,
                valueAttrName: name,
                valueAttrKey: attrKey,
                // S239 finding 5 — `value` on a form control must be written via
                // the `.value` PROPERTY, not `setAttribute`. Decided HERE because
                // this is the only place the TAG is known; the wiring emitters see
                // the binding, not the element.
                ...(name === "value" && FORM_VALUE_ELEMENTS.has(tag)
                  ? { valueAttrIsFormValue: true }
                  : {}),
                refs: val.refs,
              });
            }
          }
        } else if (val.kind === "call-ref") {
          if (name === "if" || name === "show") {
            // §5.1 line 1352 (g-attr-if-fn-call-misroute, S191): an unquoted
            // CONDITION attribute admits a bare call `fn()` as a valid atomic
            // form. Route it as a reactive conditional — NOT a (nonexistent)
            // "if"/"show" DOM event binding. Mirrors the `val.kind === "expr"`
            // if/show block above (the paren form `if=(fn())` already works
            // this way). The fn name is auto-mangled by the whole-buffer
            // `post-fn-name-mangle` pass (emit-client.ts), and `@`-ref args are
            // rewritten by `rewriteExprWithDerived` inside `emitExprField`, so a
            // raw condExpr string (condExprNode undefined) lowers identically to
            // the paren form. `refs` is advisory only — the runtime `_scrml_effect`
            // dynamically subscribes to whatever cells the call reads at run time
            // (the FIX(IS-VARIANT-ATTR) gate in emit-event-wiring accepts empty refs).
            const placeholderId = genVar(`attr_${name}`);
            const dataAttr = name === "show" ? "data-scrml-bind-show" : "data-scrml-bind-if";
            parts.push(` ${dataAttr}="${placeholderId}"`);
            if (registry) {
              const condRaw = `${val.name}(${(val.args ?? []).join(", ")})`;
              // Extract @-prefixed reactive refs from the args (bare names, no @);
              // empty is fine — dynamic effect tracking covers the rest.
              const condRefs = (val.args ?? [])
                .filter((a) => typeof a === "string" && a.startsWith("@"))
                .map((a) => a.replace(/^@/, "").split(/[.[(]/)[0]);
              registry.addLogicBinding({
                placeholderId,
                expr: condRaw,
                ...(name === "show" ? { isVisibilityToggle: true } : { isConditionalDisplay: true }),
                condExpr: condRaw,
                refs: condRefs,
                ...(transitionEnter ? { transitionEnter } : {}),
                ...(transitionExit ? { transitionExit } : {}),
              });
            }
          } else {
            // Defense-in-depth: server-only call names must not become client event bindings.
            // This can occur if the tokenizer misparses ^{} meta content in attribute position.
            const SERVER_ONLY_CALL = /^(bun\.eval|Bun\.|process\.|fs\.)/;
            if (SERVER_ONLY_CALL.test(val.name ?? "")) {
              // Silently drop — tokenizer fix should prevent this from reaching CG.
            } else {
              const placeholderId = genVar(`attr_${name}`);
              parts.push(` data-scrml-bind-${name}="${placeholderId}"`);
              if (registry) {
                registry.addEventBinding({
                  placeholderId,
                  eventName: name,
                  handlerName: val.name,
                  handlerArgs: val.args ?? [],
                  handlerArgExprNodes: val.argExprNodes,
                  // Bug 58 (S140): propagate the formFor compound cell name so the
                  // submit handler sets `@<cell>.submitted = true` + passes `values`
                  // (the collected compound value) into the handler per §41.14.3.
                  formForSubmitCell: (val as { formForSubmitCell?: string }).formForSubmitCell,
                });
              }
            }
          }
        }
      }

      // A1c C16 — §53.7.1: emit predicate-derived HTML validation attrs that
      // were not already declared by the developer (and not removed during
      // conflict resolution). These run AFTER the developer-attr loop so a
      // declared `type="email"` is emitted before the shape-derived `pattern`.
      // Conflict-overridden attrs land here too (shape-derived precedence).
      for (const [_drName, _drVal] of derivedRefinementAttrs) {
        if (_drVal === "") {
          // Boolean attribute (e.g. `required`) — emit as bareword.
          parts.push(` ${_drName}`);
        } else {
          parts.push(` ${_drName}="${escapeHtmlAttr(_drVal)}"`);
        }
      }

      // S91 A-4.4 — `data-scrml-prefetch` wiring for cross-route
      // hover-prefetch. When the current element is an `<a>` with a
      // static `href` value that resolves to a known internal route
      // (urlPattern in `RouteMap.pages`), inject the
      // `data-scrml-prefetch="<route>"` attribute. The hover-handler
      // attachment block emitted by `composeInitialChunk` consumes
      // this attribute via `querySelectorAll("a[data-scrml-prefetch]")`.
      //
      // External links, fragment-only links, and links to unknown
      // internal routes get NO attribute — the runtime handler skips
      // them silently. (Per SPEC §40.9.7: hover-prefetch fires only on
      // explicit route hints; "/foo" with no matching page falls
      // through to plain navigation.)
      //
      // Reactive / templated / expression-valued href attributes are
      // SKIPPED at A-4.4 — the static-href case is the dominant nav
      // pattern (`<a href="/loads">` etc.); reactive href values would
      // require runtime route resolution (deferred to A-4.7+).
      //
      // The flag-set side-effect activates the `prefetch` runtime
      // chunk + the IIFE-tail hover-handler attachment block in
      // composeInitialChunk; see emit-client.ts:detectRuntimeChunks
      // and route-splitter.ts:emitPerRouteChunks for the read sites.
      if (tag === "a" && liveCtx) {
        for (const attr of attrs) {
          if (!attr || attr.name !== "href") continue;
          const val = attr.value;
          if (!val || val.kind !== "string-literal") continue;
          const hrefRaw: unknown = (val as { value?: unknown }).value;
          if (typeof hrefRaw !== "string") continue;
          // Skip when the href has template interpolation (`${...}`)
          // — that's a reactive href; the resolved value isn't known
          // at emit time.
          if (hasTemplateInterpolation(hrefRaw)) continue;
          // Q-OPEN-6 — flip `hasInternalLinks` on the structural shape
          // (absolute-path string-literal, no protocol) BEFORE the
          // resolution check. This is what distinguishes case 1
          // (`W-CG-CHUNK-NO-PREFETCH`) from case 2
          // (`W-CG-CHUNK-PREFETCH-UNRESOLVED`) at the splitter's
          // post-emit lint scan: case 1 is "no internal links at all";
          // case 2 is "links exist but none resolved to RouteMap.pages".
          //
          // Mirror `resolveInternalRoute`'s shape checks (fragment-only
          // / protocol-bearing / no-leading-slash all NEGATE the
          // "internal-shaped" tag). We do NOT count those as internal
          // because they're not even attempting to wire prefetch
          // (`#section` is in-page anchor; `https://...` is external).
          if (
            !hrefRaw.startsWith("#") &&
            !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(hrefRaw) &&
            hrefRaw.startsWith("/")
          ) {
            liveCtx.hasInternalLinks = true;
          }
          const resolved = resolveInternalRoute(hrefRaw);
          if (resolved === null) break; // not internal — skip and stop scanning this element
          parts.push(` data-scrml-prefetch="${escapeHtmlAttr(resolved)}"`);
          liveCtx.hasPrefetchableLinks = true;
          break; // exactly one href per <a>; stop after wiring it
        }
      }

      // 6nz-F4 — stamp the RCDATA `.value`-bind selector into the opener before
      // the tag closes. Only when a placeholder was allocated (i.e. reactive
      // content present AND no bind:value conflict).
      if (_rcdataPlaceholderId) {
        parts.push(` data-scrml-rcdata="${_rcdataPlaceholderId}"`);
      }

      if (isSelfClosing || isVoid) {
        parts.push(" />");
        return;
      }

      parts.push(">");

      // 6nz-F4 — RCDATA reactive content carve-out. Emit the const-known parts as
      // static first-paint content (matching the bind:value model, where the
      // client sets `.value` on load; a reactive-cell part contributes nothing to
      // first paint and is filled by the effect), register ONE `rcdata-content`
      // binding driving `el.value`, and close — WITHOUT walking children through
      // the normal per-child path (which would emit the leaking span). On a
      // bind:value conflict (_rcdataParts set but no placeholder), the content is
      // dropped entirely (bind:value drives `.value`); we still skip the child
      // walk so no span leaks.
      if (_rcdataParts) {
        if (_rcdataPlaceholderId) {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { escapeHtmlText } = require("./const-fold-env.ts") as {
            escapeHtmlText: (s: string) => string;
          };
          for (const part of _rcdataParts) {
            if (part.kind === "static" && part.text) {
              parts.push(escapeHtmlText(part.text));
            }
          }
          if (registry) {
            registry.addLogicBinding({
              kind: "rcdata-content",
              placeholderId: _rcdataPlaceholderId,
              rcdataParts: _rcdataParts,
            });
          }
        }
        parts.push(`</${tag}>`);
        return;
      }

      if (csrfEnabled && tag === "form") {
        const csrfId = genVar("csrf");
        parts.push(`<input type="hidden" name="_csrf" value="" data-scrml-csrf="${csrfId}" />`);
      }

      // ss15 item-2 (S214) -- record this element as the enclosing markup
      // parent so a `${...}` logic-node child can tell whether it sits in a
      // default-logic body (<program>/<page>/<channel> -> mount effect, no
      // render slot) or inside a real markup element (-> markup-interpolation,
      // renders). See the logic-node branch below + DEFAULT_LOGIC_MODE_TAGS.
      // ss20 item-1 — if this generic markup element carries an `if=` attr it
      // took the display-toggle path (the clean-subtree mount/unmount path
      // returns early above; if-chain branches have `if=` stripped before they
      // reach here). Push its guard so descendant `${...}` interpolation effects
      // gate on the SAME predicate as the toggle. `show=` is NOT pushed (Vue
      // v-show keeps running its inner effects).
      let _ifGuardPushed = false;
      const _ifGuardAttr = attrs.find((a: any) => a.name === "if");
      if (_ifGuardAttr && _ifGuardAttr.value) {
        const _gv = _ifGuardAttr.value;
        if (_gv.kind === "expr") {
          ifGuardStack.push({ condExpr: _gv.raw, condExprNode: _gv.exprNode, refs: _gv.refs });
          _ifGuardPushed = true;
        } else if (_gv.kind === "call-ref") {
          const _condRaw = `${_gv.name}(${(_gv.args ?? []).join(", ")})`;
          const _condRefs = (_gv.args ?? [])
            .filter((a: any) => typeof a === "string" && a.startsWith("@"))
            .map((a: any) => a.replace(/^@/, "").split(/[.[(]/)[0]);
          ifGuardStack.push({ condExpr: _condRaw, refs: _condRefs });
          _ifGuardPushed = true;
        } else if (_gv.kind === "variable-ref") {
          const _ifVarName = (_gv.name ?? "").replace(/^@/, "");
          const _ifBaseVar = _ifVarName.split(".")[0];
          const _hasDotPath = _ifVarName.includes(".");
          ifGuardStack.push({ varName: _ifBaseVar, ...(_hasDotPath ? { dotPath: _ifVarName } : {}) });
          _ifGuardPushed = true;
        }
      }
      markupParentStack.push(tag);
      for (const child of children) {
        emitNode(child);
      }
      markupParentStack.pop();
      if (_ifGuardPushed) ifGuardStack.pop();

      parts.push(`</${tag}>`);
      return;
    }

    // For logic blocks embedded in markup, emit a placeholder span for client JS
    if (node.kind === "logic") {
      // ss15 item-2 (S214) -- DEFAULT-LOGIC-MODE GUARD.
      //
      // A logic node whose enclosing markup parent is <program>/<page>/<channel>
      // -- or which sits at the file top-level (empty stack: also a default-logic
      // root) -- is a default-logic body per SPEC section 40.8 (SPEC.md:10347).
      // Its bare expressions are mount EFFECTS (sections 17.3 + 6.7.1a): they run
      // once at initial mount and do NOT render their return as a text node.
      // `on mount { val() }` desugars to exactly such a bare-expr.
      //
      // In this position we MUST NOT allocate a `<span data-scrml-logic>` render
      // slot, MUST NOT call addLogicBinding, and MUST NOT constant-fold the
      // expression to inline text (folding is observationally a render). We
      // return early WITHOUT stamping `_placeholderId`; emit-reactive-wiring.ts
      // then classifies the node as a file-scope/mount-effect group and emits
      // its body as the effect call (the `_scrml_val_2();` line) -- exactly the
      // pre-S107 path for declaration-only logic bodies.
      //
      // A `${...}` logic node nested inside ANY OTHER markup element (a <div>, a
      // <span>, a component root, etc.) is a markup-interpolation that DOES
      // render -- it falls through this guard to the unchanged path below.
      const enclosingMarkupTag = markupParentStack.length > 0
        ? markupParentStack[markupParentStack.length - 1]
        : null;
      const inDefaultLogicMode = enclosingMarkupTag === null
        || DEFAULT_LOGIC_MODE_TAGS.has(enclosingMarkupTag);
      // A lift-expr (`${ for (...) { lift <li/> } }`, the Tier-0 iteration form
      // §17.4) is a DOM-positioning target that renders in ANY context, default-
      // logic bodies included. The guard suppresses ONLY the spurious bare-expr
      // render slot; a logic node that contains a lift-expr keeps its placeholder
      // + lift wiring and falls through to the normal path below.
      const bodyHasLift = (node.body ?? []).some((child: any) => stmtContainsLiftExpr(child));
      if (inDefaultLogicMode && !bodyHasLift) return;

      // inline-value-form-interp (§18.0 / §17.6) — VALUE-FORM CONTROL-FLOW AS
      // THE SOLE INTERP CONTENT. A `${ match @x { .A :> v … } }` /
      // `${ if c { a } else { b } }` whose only body statement is a value-
      // producing control-flow construct is a value EXPRESSION (a match/if-as-
      // expression, SPEC §18.0 / §17.6), not a discarded statement: it must
      // render its selected value and reactively update on its scrutinee/
      // condition deps — exactly like the `const <d> = match …; ${@d}` derived-
      // cell twin, but without the intermediate named cell.
      //
      // Pre-fix: the match-form got NO slot (the classifier below only finds
      // bare-expr / lift-expr, never a `match-stmt` arm) and emit-reactive-wiring
      // emitted the match as a value-DISCARDING file-scope IIFE; the if-form got
      // a slot but the binding loop (bare-expr-only) never wired it, so the
      // branch values were discarded and the slot stayed empty.
      //
      // Fix: allocate the render slot here and register a `value-control-flow`
      // logic-binding carrying the raw control-flow node. emit-event-wiring.ts
      // lowers it to the value-returning form (emit-control-flow.ts:
      // emitMatchExpr IIFE / emitIfValueExpr ternary cascade) and emits the
      // `_scrml_render_value` + reactive `_scrml_effect` wiring.
      //
      // A NON-value shape (block-arm match, else-less / leading-statement if,
      // multi-statement body) is NOT matched by isValueFormControlFlowStmt and
      // keeps the prior behavior. Gated on `registry` (the live HTML pass): the
      // legacy errors-only signature has no binding sink, so it falls through
      // rather than stamping an orphan slot.
      if (
        registry &&
        Array.isArray(node.body) &&
        node.body.length === 1 &&
        isValueFormControlFlowStmt(node.body[0])
      ) {
        const placeholderId = genVar("logic");
        (node as any)._placeholderId = placeholderId;
        // Mark the wrapper so emit-reactive-wiring's file-scope walker skips
        // re-emitting the control-flow body as a value-DISCARDING statement
        // (the dead `(function(){…})()` for match / `if(){…}else{…}` for if).
        // Its value is rendered into the slot by emit-event-wiring instead.
        // Mirrors the `_constantFolded` marker (collect.ts propagates it to the
        // inner child stmt; emit-reactive-wiring skips on it).
        (node as any)._valueControlFlowRendered = true;
        parts.push(`<span data-scrml-logic="${placeholderId}"></span>`);
        registry.addLogicBinding({
          kind: "value-control-flow",
          placeholderId,
          controlFlowNode: node.body[0],
        });
        return;
      }

      if (node.body?.length === 1 && node.body[0]?.kind === "bare-expr") {
        const bareExpr = node.body[0];
        // Phase 4d Step 8: ExprNode-first; runtime-only string fallback (bare-expr.expr TS field deleted)
        const expr: string = bareExpr.exprNode ? emitStringFromTree(bareExpr.exprNode) : (bareExpr.expr ?? "");

        // S130 Phase 2 (HU-2 Q4 / F-003) — the former `${ bun.eval(...) }`
        // user-facing inline-evaluation surface (former SPEC §30.2) is RETIRED
        // per Approach C extension (SPEC §22.12). User-source `bun.eval()` in
        // `${...}` interpolation is no longer recognized as a special-case
        // compile-time-fold path. The pre-S130 inline-evaluator block that
        // previously lived here is removed; user-written `${bun.eval(...)}`
        // now falls through to the standard constant-fold + runtime-binding
        // path below, where `bun` is no longer in META_BUILTINS and triggers
        // E-META-001 at meta-checker time.

        // S108 Bug 5 Phase 3 — Constant-fold (Option γ).
        //
        // SPEC §7.4.2 (S108 amendment) normative permission: "When `expr`
        // references NO reactive cells AND the expression collapses to a
        // compile-time-known constant value (literal, `const`-bound to a
        // literal, simple arithmetic on constants), the compiler MAY inline
        // the string value directly into the emitted HTML at that position.
        // This is a permitted optimization — the rendered output is
        // observationally equivalent."
        //
        // The canonical adopter shape this folds is:
        //   const VERSION = "v0.3.0"
        //   <span class="pill">${VERSION}</span>
        // → inline `v0.3.0` directly into the HTML body, zero placeholder,
        // zero JS wiring, zero runtime cost.
        //
        // Falls through to the existing placeholder + binding path when:
        //   - any reactive cell reference (`@x`) appears in the expr
        //   - any unresolved identifier (not in file-level const env) appears
        //   - the expression collapses to null/undefined (runtime String()
        //     coercion semantics preserved per SPEC §7.4.2 normative statement)
        //   - the expression collapses to a compound value (array/object —
        //     inline would emit `[object Object]` which is worse adopter UX
        //     than runtime String() coercion)
        //
        // Tilde guard: when expr contains a `~` reference, the rewriter at
        // emit-reactive-wiring.ts hoists multi-statement bodies to file
        // scope BEFORE this branch runs. The hoisted form is a synthetic
        // `_scrml_tilde_N` reference — NOT in the const env — so the fold
        // correctly defers to the runtime path. No special tilde handling
        // needed here.
        //
        // Helper module: ./const-fold-env.ts — builds the env once per
        // file (cached on fileAST._constFoldEnvCache) and provides
        // tryFoldInterpolation + escapeHtmlText.
        const liveCtxForFold = ctxOrErrors && typeof ctxOrErrors === "object" && "fileAST" in ctxOrErrors
          ? (ctxOrErrors as CompileContext)
          : null;
        if (liveCtxForFold && bareExpr.exprNode) {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { tryFoldInterpolation, escapeHtmlText } = require("./const-fold-env.ts") as {
            tryFoldInterpolation: (exprNode: any, fileAST: any) => string | null;
            escapeHtmlText: (s: string) => string;
          };
          const folded = tryFoldInterpolation(bareExpr.exprNode, liveCtxForFold.fileAST);
          if (folded !== null) {
            // Mark the logic node as constant-folded so the file-scope statement
            // walker (collectTopLevelLogicStatements + emit-reactive-wiring.ts's
            // Anomaly-B skip clause) skips emitting the orphan bare-expr like
            // `"hello";` at file scope. Without this marker, the literal still
            // emits as a no-op statement at file-scope JS (visible bloat).
            (node as any)._constantFolded = true;
            parts.push(escapeHtmlText(folded));
            return;
          }
        }
      }

      // Bug 5 Phase 2 (S107, 2026-05-19) — Anomaly C fix.
      //
      // Pre-S107 unconditionally allocated a placeholder for every logic node
      // in markup-walk position. The implicit logic-wrap of bare statements
      // inside `<program>` body (S101 §40.8 program-as-container) then
      // produced phantom `<span data-scrml-logic>` nodes for declaration-only
      // bodies like `const VERSION = "v0.3.0"` — visible bloat in adopter-
      // inspected DOM with no purpose (declarations have no DOM presence).
      //
      // Fix: only emit a placeholder when the body has RENDERABLE content —
      // bare-expr (interpolation values consumed by binding wiring) or
      // lift-expr (DOM positioning targets via lift-target wiring). Pure
      // declarations / function decls / type decls produce file-scope JS
      // only and need no DOM anchor.
      //
      // Phase 1 left this behavior unchanged; Phase 2 closes it. Downstream
      // emit-reactive-wiring.ts groups by `_placeholderId` — when this branch
      // skips placeholder allocation, the resulting node has no `_placeholderId`
      // annotation, so the file-scope-statement-emit loop classifies it as a
      // non-pid (file-level) group and emits its body normally.
      const bodyHasRenderableContent = (node.body ?? []).some((child: any) => stmtContainsRenderableLogic(child));
      if (!bodyHasRenderableContent) return;

      const placeholderId = genVar("logic");
      // Annotate the AST node with its placeholder ID so the client JS emitter
      // can target lift-exprs to the correct DOM position.
      (node as any)._placeholderId = placeholderId;
      parts.push(`<span data-scrml-logic="${placeholderId}"></span>`);
      if (registry && node.body) {
        for (const child of node.body) {
          // g-onmount-async (S217) — DEFAULT-LOGIC-MODE BARE-EXPR IS AN EFFECT.
          //
          // We only reach this binding loop in default-logic mode when the EARLY
          // RETURN above was skipped because a sibling `lift-expr` forced the
          // placeholder (bodyHasLift). The lift gets its DOM position via
          // `_placeholderId` + lift-target wiring (emit-reactive-wiring.ts); a
          // bare-expr sharing the SAME logic node is STILL a mount effect (SPEC
          // §17.3 + §6.7.1a — `on mount { boot() }` desugars to such a bare-expr).
          // Registering it as a logic-binding made emit-event-wiring.ts emit
          // `_scrml_render_value(el, boot())` (the call's RETURN renders to the
          // DOM — `[object Promise]` for an async/CPS call) plus, when the body
          // reads a reactive cell, a re-running `_scrml_effect` wrapper. In a
          // default-logic body a bare-expr NEVER renders and NEVER re-runs; skip
          // the binding so it falls to the file-scope/mount-effect emit path —
          // exactly the early-return semantics, just without the placeholder the
          // sibling lift legitimately needs. A `${...}` nested in a real markup
          // descendant (inDefaultLogicMode === false) is UNCHANGED (it renders).
          // A desugared `on mount {}` / `on dismount {}` (SPEC §6.7.1a/b) is a
          // fire-and-forget lifecycle effect: it runs ONCE at mount and NEVER
          // renders its return, in ANY enclosing context — including a
          // `<program db=>` / `<db>` state-block body, where the enclosing tag
          // is "state" so inDefaultLogicMode is false. Skip its binding so it
          // falls to the file-scope/mount-effect emit path. (The flogence shape:
          // `on mount { boot() }` as the tail statement of the big program-body
          // `${...}` block that the `<db>` context wraps.)
          if (child && child.kind === "bare-expr" && (child as any)._onMountEffect) continue;
          if (inDefaultLogicMode && child && child.kind === "bare-expr") continue;
          // Phase 4d Step 8: ExprNode-first; runtime-only string fallback (bare-expr.expr TS field deleted)
          if (child && child.kind === "bare-expr" && (child.exprNode || child.expr)) {
            const exprStr = child.exprNode ? emitStringFromTree(child.exprNode) : child.expr;
            const reactiveRefs = fnBodyRegistry
              ? extractReactiveDepsTransitive(exprStr, reactiveVarNames, fnBodyRegistry)
              : extractReactiveDeps(exprStr, reactiveVarNames);
            // §6.7.7 — a `${<#id>.data}` request-state interpolation carries no
            // `@var` dep but IS reactive (the `_scrml_request_<id>` deep-reactive
            // Proxy). Mark it so emit-event-wiring forces the effect-wrapped path.
            const hasRequestRef = exprHasRequestRef(exprStr);
            // errorBoundary (§19.6) — when this `${...}` interpolation sits in a
            // boundary subtree, stamp the innermost boundary's catch context so
            // emit-event-wiring.ts emits the typed-error dispatch + the C-hybrid
            // host-JS backstop (§19.6.8) instead of a bare textContent write.
            const eb = boundaryStack.length > 0 ? boundaryStack[boundaryStack.length - 1] : null;
            // ss20 item-1 — stamp the innermost enclosing `if=` display-toggle
            // guard (if any) so emit-event-wiring gates this interpolation's
            // effect on the same predicate as the toggle.
            const ifg = ifGuardStack.length > 0 ? ifGuardStack[ifGuardStack.length - 1] : null;
            registry.addLogicBinding(eb
              ? {
                  placeholderId, expr: exprStr, exprNode: child.exprNode, reactiveRefs,
                  ...(hasRequestRef ? { hasRequestRef: true } : {}),
                  ...(ifg ? { ifGuard: ifg } : {}),
                  boundaryId: eb.boundaryId,
                  boundaryFallbackExpr: eb.fallbackExpr,
                  boundaryHasFallback: eb.hasFallback,
                  boundaryVariantRenders: eb.variantRenders,
                }
              : { placeholderId, expr: exprStr, exprNode: child.exprNode, reactiveRefs, ...(hasRequestRef ? { hasRequestRef: true } : {}), ...(ifg ? { ifGuard: ifg } : {}) });
          }
        }
      }
      return;
    }

    if (isMetaKind(node.kind)) {
      if (node.id != null) {
        const metaScopeId = `_scrml_meta_${node.id}`;
        parts.push(`<span data-scrml-meta="${metaScopeId}"></span>`);
      }
      return;
    }

    // Phase A10 (S78, 2026-05-10) — engine-decl mount slot + initial-arm body.
    //
    // Pre-A10 emit-html.ts had NO engine-decl case; engine-decl nodes fell
    // through emitNode silently (engines emit JS substrate, not HTML, per
    // C12/C13/C14/C15). Phase A10 changes this: the engine renders state-
    // child bodies via a JS dispatcher that writes innerHTML to a mount
    // slot. The mount slot must exist in the static HTML at module-init so
    // file-level reactive-wiring can bind to placeholders inside the
    // initial-arm body. emit-engine.ts:emitEngineMountHtml builds the slot
    // (with the initial arm's HTML inside) by calling generateHtml on the
    // initial arm's filtered body — which registers all bindings in
    // ctx.registry just like the program-scope HTML pass would.
    //
    // Tree-shake: emitEngineMountHtml returns "" when the engine has no
    // arm bodies (all empty); we emit nothing in that case (the C12 JS
    // substrate emission preserves the marker comment for debug).
    //
    // Out-of-scope here: the JS-side dispatcher + render functions; those
    // come from emit-engine.ts:emitEngineBodyRenderForFile, called by
    // emit-client.ts adjacent to the C12 substrate.
    if (node.kind === "engine-decl") {
      // Recursive require avoids TS circular dep with emit-engine.ts (which
      // imports nothing from emit-html.ts; this require is one-way).
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { emitEngineMountHtml } = require("./emit-engine.ts") as {
        emitEngineMountHtml: (decl: any, ctx: any) => string | null;
      };
      // Pass the live ctx (constructed at the top of generateHtml from the
      // legacy or new signature). Falls through to "" when ctx is the
      // legacy errors-only signature path — consistent with pre-A10
      // behavior (no HTML emitted).
      const liveCtx = ctxOrErrors && typeof ctxOrErrors === "object" && "fileAST" in ctxOrErrors
        ? (ctxOrErrors as CompileContext)
        : null;
      if (liveCtx) {
        const html = emitEngineMountHtml(node, liveCtx);
        if (html) parts.push(html);
      }
      return;
    }

    // S108 Phase 3 — match-block mount slot (SPEC §18.0.1).
    //
    // Mirrors the engine-decl case above. Match-blocks have a `<div
    // data-scrml-match-mount="match_<id>">` mount slot at their source
    // position; the dispatcher emitted by emit-match.ts:emitMatchBodyRender
    // ForFile (called from emit-client.ts) writes the matching arm's HTML
    // into the slot on each cell change.
    //
    // Per the helper's Shape A DOMContentLoaded initial-fire bridge, the
    // mount slot is emitted EMPTY at module-init — no initial-arm seed
    // (contrast engine-decl, where `initial=` selects a static initial
    // variant deterministically at parse time; match-block has no such
    // selector, so the current cell value at module load is runtime-only
    // authority).
    //
    // Tree-shake: when all arm bodies are empty OR `on=` resolution fails
    // (E-MATCH-ON-REQUIRED upstream), emit-match returns "" / null and we
    // emit nothing.
    if (node.kind === "match-block") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { emitMatchMountHtml } = require("./emit-match.ts") as {
        emitMatchMountHtml: (node: any, ctx: any) => string | null;
      };
      const liveCtx = ctxOrErrors && typeof ctxOrErrors === "object" && "fileAST" in ctxOrErrors
        ? (ctxOrErrors as CompileContext)
        : null;
      if (liveCtx) {
        const html = emitMatchMountHtml(node, liveCtx);
        if (html) parts.push(html);
      }
      return;
    }

    // S130 HU-1 iteration Landing 1 — each-block mount slot
    // (SPEC §17.X NEW).
    //
    // Mirrors the engine-decl / match-block cases above. Each-blocks
    // have a `<div data-scrml-each-mount="each_<id>">` mount slot at
    // their source position; the dispatcher emitted by
    // emit-each.ts:emitEachBodyRenderForFile (called from emit-client.ts)
    // writes the rendered iteration into the slot on subscription fire.
    //
    // Tree-shake: when the each-block has no template + no empty, the
    // mount helper returns "" and nothing emits.
    if ((node as any).kind === "each-block") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { emitEachMountHtml } = require("./emit-each.ts") as {
        emitEachMountHtml: (node: any, ctx: any) => string;
      };
      const liveCtx = ctxOrErrors && typeof ctxOrErrors === "object" && "fileAST" in ctxOrErrors
        ? (ctxOrErrors as CompileContext)
        : null;
      if (liveCtx) {
        const html = emitEachMountHtml(node, liveCtx);
        if (html) parts.push(html);
      }
      return;
    }
  }

  // §36 Phase 2.B (S89): E-INPUT-005 duplicate input-state-id-within-scope check.
  // Runs as a separate pre-walk so its scope tracking is decoupled from the
  // main HTML emitter's traversal concerns (templates, if-chains, engine
  // dispatchers, render-by-tag expansion, etc.). See `checkInputStateDuplicateIds`
  // for scope semantics and SPEC §36.5.1 (S89 OQ-B Option α).
  if (errors) {
    checkInputStateDuplicateIds(nodes, errors);
  }

  for (const node of nodes) {
    emitNode(node);
  }

  return parts.join("");
}

// ---------------------------------------------------------------------------
// A-4.7 — Per-route HTML augmentation (§40.9.7 + OQ-A4-E hybrid)
// ---------------------------------------------------------------------------

/**
 * Per-(EntryPointId, RoleVariant, ChunkTier) descriptor exposed on
 * `_SCRML_CHUNKS` and consumed by `_scrml_prefetch_tier2` /
 * the role-bootstrap script in the augmented HTML head.
 *
 * Shape matches the URL-style serialization produced by
 * `route-splitter.ts:serializeChunksManifest` (string filename values
 * with leading `/`, or null for missing chunks).
 */
interface ChunkUrlByTier {
  initial?: string | null;
  tier1?: string | null;
  tier2?: string | null;
  tierN?: Array<string | null>;
}

/**
 * Route-keyed manifest view consumed by the runtime helpers.
 *
 * `_SCRML_CHUNKS[routePath][roleVariant] = ChunkUrlByTier`.
 *
 * `routePath` is the URL the bootstrap can match the active page on
 * (e.g. `"/loads"`, `"/"`). Anonymous-role keys land under the literal
 * `"_anonymous"` role string (matches the RS A-2.5 floor sentinel +
 * `route-splitter.ts:ANONYMOUS_ROLE`).
 */
type RouteKeyedChunkManifest = Record<string, Record<string, ChunkUrlByTier>>;

/**
 * Minimal chunks input shape required by `augmentHtmlForChunks`.
 *
 * Decoupled from the full `ChunkOutput` type (which lives in
 * `route-splitter.ts`) so this module doesn't have a hard import on
 * route-splitter — keeps the dependency graph one-directional
 * (route-splitter → emit-html is fine; emit-html → route-splitter is
 * not).
 */
export interface HtmlAugmentChunk {
  entryPointId: string;
  role: string;
  tier: string;
  /** Output filename relative to dist root (no leading slash). */
  filename: string;
  /** Bytes; when zero the chunk is not written to disk. */
  payloadJs: string;
}

export interface HtmlAugmentInput {
  /** The already-composed HTML document (full `<!DOCTYPE>` envelope). */
  html: string;
  /**
   * Chunks for the current per-file compilation, keyed by ChunkKey.
   * Same map shape as `EmitPerRouteResult.chunks` (route-splitter.ts).
   */
  chunks: Map<string, HtmlAugmentChunk>;
  /**
   * EntryPointIds that BELONG to this file. The augmenter picks the
   * FIRST id as the active-route anchor for the role-bootstrap script.
   *
   * Sourced from `reachabilityRecord.closures` filtered by file-path
   * prefix (mirrors `emit-client.ts:detectRuntimeChunks` matching).
   */
  fileEntryPointIds: string[];
  /**
   * Map from EntryPointId → routePath (URL the bootstrap matches on).
   *
   * For `<file>#program` entries: derived from the file's program
   * route (typically `"/"` for SPA entries OR the RouteMap-resolved
   * SPA root). For `<file>#page@<route>` entries: the trailing
   * `<route>` segment is used directly. For `<file>#page-<N>` entries:
   * resolved via RouteMap.pages (positional index).
   *
   * Best-effort — when an EpId cannot be resolved (test fixtures that
   * bypass RI), it is omitted from the inlined `_SCRML_CHUNKS`. The
   * augmenter still emits the bootstrap script for the FIRST EpId in
   * `fileEntryPointIds`; lookup failures degrade to the
   * `console.warn` path in `_scrml_prefetch_tier2`.
   */
  epIdToRoutePath: Map<string, string>;
}

/**
 * Augment a per-file HTML document with the A-4.7 chunk-activation
 * scaffolding:
 *
 *   1. `<script>window._SCRML_CHUNKS = { ... }</script>` inline (BEFORE
 *      the role-bootstrap), route-keyed for `_scrml_prefetch_tier2`
 *      compatibility.
 *   2. `<script>` role-detection bootstrap (localStorage > cookie >
 *      <meta name="scrml-role"> > "_anonymous") dispatching to the
 *      per-role initial chunk via dynamic `<script>` injection.
 *   3. `<link rel="modulepreload">` for non-empty tier-1 chunks of the
 *      active entry point (belt-and-suspenders alongside the runtime
 *      `requestIdleCallback` prefetch).
 *
 * Per OQ-A4-E (S91 ratification — hybrid): ONE HTML per route +
 * role-detection bootstrap loads the per-role initial chunk. No
 * per-(route, role) HTML files are emitted.
 *
 * **Determinism (§40.9.8):** the augmented HTML output is a pure
 * function of the input — identical chunks + identical HTML →
 * identical augmented bytes. Map iteration uses the ChunkOutput
 * insertion order, which is canonical per route-splitter.ts
 * (deterministic from RS output).
 *
 * **Tree-shake invariant:** when `chunks` is empty (no entry points
 * for this file), the augmenter returns the input HTML unchanged.
 *
 * @param input HTML + chunks descriptor map + EpId→route lookup.
 * @returns The augmented HTML document (`html` with the
 *   `_SCRML_CHUNKS` inline + role-bootstrap + modulepreload links
 *   injected immediately after `</head>` is opened — or unchanged
 *   when there's nothing to augment).
 */
export function augmentHtmlForChunks(input: HtmlAugmentInput): string {
  const { html, chunks, fileEntryPointIds, epIdToRoutePath } = input;

  // No entry points belong to this file → no augmentation possible.
  // Return the input HTML unchanged for byte-identity preservation
  // (matches the pre-A-4.7 no-op behavior for files without entries).
  if (fileEntryPointIds.length === 0) return html;

  // Build the route-keyed manifest. The runtime helpers
  // (`_scrml_prefetch_tier2`, the bootstrap script) lookup by
  // routePath first; the on-disk chunks.json uses EpId keys. We
  // translate at inline-emit time.
  const routeKeyedManifest: RouteKeyedChunkManifest = {};

  for (const chunk of chunks.values()) {
    const routePath = epIdToRoutePath.get(chunk.entryPointId);
    if (typeof routePath !== "string" || routePath === "") continue;
    if (!routeKeyedManifest[routePath]) routeKeyedManifest[routePath] = {};
    if (!routeKeyedManifest[routePath][chunk.role]) {
      routeKeyedManifest[routePath][chunk.role] = {};
    }
    const entry = routeKeyedManifest[routePath][chunk.role];
    const url = `/${chunk.filename}`;
    if (chunk.tier === "initial") {
      entry.initial = url;
    } else if (chunk.tier === "tier1") {
      // Only surface tier-1 URL when the chunk has actual payload bytes
      // (empty admission → no tier-1 file written; the URL would 404).
      if (chunk.payloadJs !== "") entry.tier1 = url;
    } else if (chunk.tier === "tier2") {
      if (chunk.payloadJs !== "") entry.tier2 = url;
    } else if (chunk.tier.startsWith("tierN")) {
      if (chunk.payloadJs !== "") {
        if (!Array.isArray(entry.tierN)) entry.tierN = [];
        entry.tierN.push(url);
      }
    }
  }

  // Active route — bootstrap dispatches to the chunk for THIS HTML's
  // entry point. Use the FIRST EpId in `fileEntryPointIds` (each file
  // emits ONE HTML in the per-file-emit pipeline; the first EpId is
  // the file's anchor).
  const activeEpId = fileEntryPointIds[0];
  const activeRoute = epIdToRoutePath.get(activeEpId);

  // When the active route cannot be resolved (test fixtures without
  // a RouteMap), the bootstrap still ships but uses a defensive
  // lookup against the FIRST route key in the manifest. The
  // bootstrap stays runnable; only the per-role chunk dispatch
  // degrades to console-warn.
  const activeRouteLit = typeof activeRoute === "string" && activeRoute !== ""
    ? JSON.stringify(activeRoute)
    : "null";

  // Compose the inline `<script>` blocks.
  const inlineParts: string[] = [];

  // 1. `_SCRML_CHUNKS` inline manifest.
  //
  // Use `JSON.stringify(..., null, 2)` for adopter readability;
  // adopters inspecting the HTML source can see the chunk URL table
  // without a debugger round-trip. Deterministic across builds
  // (object-key iteration order is insertion order; chunks.values()
  // iteration is canonical from route-splitter).
  const manifestJson = JSON.stringify(routeKeyedManifest, null, 2);
  inlineParts.push(`  <script>window._SCRML_CHUNKS = ${manifestJson};</script>`);

  // 2. `<link rel="modulepreload">` belt-and-suspenders prefetch for
  // the active entry point's tier-1 chunks (one per role variant
  // when non-empty). Browsers that honor modulepreload start
  // fetching immediately on parse; the runtime `requestIdleCallback`
  // call in `_scrml_prefetch_tier1` then schedules the script-side
  // prefetch after first paint. Both surfaces compose: an early
  // modulepreload populates the HTTP cache; the idle callback then
  // exercises the cache hit.
  //
  // Per SCOPING §3.7 (2): tier-1 fetch is runtime-mediated via
  // requestIdleCallback; modulepreload is the additional surface.
  if (typeof activeRoute === "string" && activeRoute !== "") {
    const activeRouteEntry = routeKeyedManifest[activeRoute];
    if (activeRouteEntry) {
      // Sort role keys for determinism (Object iteration order is
      // insertion-order which is canonical, but explicit sort guards
      // against any future Map-iteration-order changes in the
      // splitter).
      const roles = Object.keys(activeRouteEntry).sort();
      for (const role of roles) {
        const tier1Url = activeRouteEntry[role].tier1;
        if (typeof tier1Url === "string" && tier1Url !== "") {
          inlineParts.push(
            `  <link rel="modulepreload" href="${escapeHtmlAttr(tier1Url)}">`,
          );
        }
      }
    }
  }

  // 3. Role-detection bootstrap script.
  //
  // Order of preference for the role hint: localStorage > cookie >
  // <meta name="scrml-role"> > "_anonymous" (per OQ-A4-E hybrid +
  // RS A-2.5 Component 4 sentinel).
  //
  // localStorage access is wrapped in a try/catch because Safari
  // private-mode (and some Chrome shapes) throw on access. The
  // try/catch is HOST-JS (the bootstrap runs in the adopter
  // browser), NOT scrml — pa.md try/catch ban applies to scrml
  // source only.
  //
  // The bootstrap dispatches by injecting a `<script defer>` for
  // the chosen chunk URL. `defer` keeps the chunk evaluation in
  // document-order alongside any other deferred scripts (the
  // per-file `.client.js` etc.).
  //
  // When no chunk URL is found for the resolved role + active route,
  // the bootstrap warns to the console and proceeds — the per-file
  // `.client.js` continues to load, so the page degrades to the
  // pre-chunk shape (full per-file runtime, no per-role
  // optimization).
  inlineParts.push(`  <script>
    // scrml role-detection bootstrap (A-4.7 + OQ-A4-E hybrid).
    // Reads role hint from localStorage > cookie > <meta> > _anonymous;
    // dispatches to the role-appropriate initial chunk via dynamic
    // <script> injection.
    (function () {
      function getRole() {
        try {
          var ls = localStorage.getItem("scrml_role");
          if (ls) return ls;
        } catch (e) {}
        var cookieMatch = document.cookie.match(/(?:^|;\\s*)scrml_role=([^;]+)/);
        if (cookieMatch) return decodeURIComponent(cookieMatch[1]);
        var meta = document.querySelector('meta[name="scrml-role"]');
        if (meta) return meta.getAttribute("content");
        return "_anonymous";
      }
      var activeRoute = ${activeRouteLit};
      if (typeof activeRoute !== "string" || activeRoute === "") {
        if (typeof console !== "undefined" && console.warn) {
          console.warn("scrml: no active route for chunk bootstrap; skipping");
        }
        return;
      }
      var role = getRole();
      var byRoute = window._SCRML_CHUNKS && window._SCRML_CHUNKS[activeRoute];
      var byRole = byRoute && byRoute[role];
      var chunkUrl = byRole && byRole.initial;
      if (!chunkUrl) {
        if (typeof console !== "undefined" && console.warn) {
          console.warn("scrml: no chunk for role '" + role + "' at route '" + activeRoute + "'");
        }
        return;
      }
      var s = document.createElement("script");
      s.src = chunkUrl;
      s.defer = true;
      document.head.appendChild(s);
    })();
  </script>`);

  const injection = inlineParts.join("\n");

  // Inject BEFORE `</head>` so the manifest + modulepreload + bootstrap
  // are in the head — same precedence as the per-file `<link rel="stylesheet">`
  // and (when embed mode is off) the scrml-runtime.js `<script>` tag
  // emitted by index.ts.
  //
  // Defensive: when the input HTML has no `</head>` (degenerate fixture
  // path), return the HTML unchanged. The augmentation requires a
  // well-formed head; the no-`</head>` case is a no-op.
  const headCloseIdx = html.indexOf("</head>");
  if (headCloseIdx === -1) return html;
  return html.substring(0, headCloseIdx) + injection + "\n" + html.substring(headCloseIdx);
}

