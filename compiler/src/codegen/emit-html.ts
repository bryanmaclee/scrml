import { genVar } from "./var-counter.ts";
import { emitStringFromTree, exprNodeContainsMemberAccess } from "../expression-parser.ts";
// F8 / v0.6 — dual-mode meta-block kind test (live `"meta"` / native `"Meta"`).
import { isMetaKind } from "../types/ast.ts";
import { escapeHtmlAttr, VOID_ELEMENTS } from "./utils.ts";
import { extractReactiveDeps, collectReactiveVarNames, extractReactiveDepsTransitive, buildFunctionBodyRegistry } from "./reactive-deps.ts";
import { hasTemplateInterpolation } from "./rewrite.js";
import { CGError } from "./errors.ts";
import type { BindingRegistry } from "./binding-registry.ts";
import type { CompileContext } from "./context.ts";
import { isFlatDeclarationBlock, renderFlatDeclarationAsInlineStyle } from "./emit-css.ts";
// SPEC §6.4 / §5.4.1 / L17 — A1c C3 render-by-tag expansion. lookupStateCell resolves
// `<userName/>` to its decl record; getCellKind surfaces B5's `_cellKind` annotation
// (`"bindable"` for Shape 2 with bindable RHS — the only legal use kind that survives
// B6's diagnostic walker).
import { lookupStateCell, getCellKind } from "../symbol-table.ts";
// A1c C16 — §53.7.1 HTML attr generation for refinement-typed bindable cells.
// `parsePredicateAnnotation` extracts the predicate from a typeAnnotation string;
// `deriveHtmlAttrs` maps the predicate to native HTML validation attributes.
import { parsePredicateAnnotation, deriveHtmlAttrs } from "./emit-predicates.ts";
// A1c C16 — `buildReactiveTypeMap` walks the file AST for `state-decl` typeAnnotations
// keyed by var-name (mirrors emit-bindings.ts §53.7.2 path for runtime gating).
import { buildReactiveTypeMap } from "./emit-bindings.ts";
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
      for (const child of node.children ?? []) {
        emitNode(child);
      }
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
          emitNode(stripped);
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
          emitNode(stripped);
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
        for (const child of children) {
          emitNode(child);
        }
        boundaryStack.pop();

        parts.push("</div>");
        return;
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

      if (tag === "program") {
        // Named programs are worker bundles (§4.12.4) — skip entirely.
        // Only emit children for the unnamed/root program.
        const nameAttr = attrs.find((a: any) => a.name === "name");
        if (nameAttr) return;
        for (const child of children) {
          emitNode(child);
        }
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
        for (const child of children) {
          emitNode(child);
        }
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
            const inline = renderFlatDeclarationAsInlineStyle(child);
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
        (ifAttrCheck.value.kind === "variable-ref" || ifAttrCheck.value.kind === "expr") &&
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
        const decl = lookupStateCell(fileScope, tag);
        const cellKind = decl ? getCellKind(decl.declNode as any) : undefined;
        if (decl && cellKind === "bindable") {
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
                cellName: tag,
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
          continue;
        }

        if (name.startsWith("class:")) {
          const classBindId = genVar(`class_${name.replace(":", "_")}`);
          parts.push(` data-scrml-${name.replace(":", "-")}="${classBindId}"`);
          if (!attr._bindId) attr._bindId = classBindId;
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
            const placeholderId = genVar(`attr_${name}`);
            parts.push(` data-scrml-bind-bool-${name}="${placeholderId}"`);
            if (registry) {
              registry.addLogicBinding({
                placeholderId,
                expr: val.raw,
                isReactiveBoolAttr: true,
                boolAttrName: name,
                condExpr: val.raw,
                condExprNode: val.exprNode,
                refs: val.refs,
              });
            }
          }
        } else if (val.kind === "call-ref") {
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

      if (isSelfClosing || isVoid) {
        parts.push(" />");
        return;
      }

      parts.push(">");

      if (csrfEnabled && tag === "form") {
        const csrfId = genVar("csrf");
        parts.push(`<input type="hidden" name="_csrf" value="" data-scrml-csrf="${csrfId}" />`);
      }

      for (const child of children) {
        emitNode(child);
      }

      parts.push(`</${tag}>`);
      return;
    }

    // For logic blocks embedded in markup, emit a placeholder span for client JS
    if (node.kind === "logic") {
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
          // Phase 4d Step 8: ExprNode-first; runtime-only string fallback (bare-expr.expr TS field deleted)
          if (child && child.kind === "bare-expr" && (child.exprNode || child.expr)) {
            const exprStr = child.exprNode ? emitStringFromTree(child.exprNode) : child.expr;
            const reactiveRefs = fnBodyRegistry
              ? extractReactiveDepsTransitive(exprStr, reactiveVarNames, fnBodyRegistry)
              : extractReactiveDeps(exprStr, reactiveVarNames);
            // errorBoundary (§19.6) — when this `${...}` interpolation sits in a
            // boundary subtree, stamp the innermost boundary's catch context so
            // emit-event-wiring.ts emits the typed-error dispatch + the C-hybrid
            // host-JS backstop (§19.6.8) instead of a bare textContent write.
            const eb = boundaryStack.length > 0 ? boundaryStack[boundaryStack.length - 1] : null;
            registry.addLogicBinding(eb
              ? {
                  placeholderId, expr: exprStr, exprNode: child.exprNode, reactiveRefs,
                  boundaryId: eb.boundaryId,
                  boundaryFallbackExpr: eb.fallbackExpr,
                  boundaryHasFallback: eb.hasFallback,
                  boundaryVariantRenders: eb.variantRenders,
                }
              : { placeholderId, expr: exprStr, exprNode: child.exprNode, reactiveRefs });
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

