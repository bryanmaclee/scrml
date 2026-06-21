/**
 * @module codegen/collect-class-names
 *
 * AST walker that collects every class name appearing in the file's markup,
 * including class names reachable ONLY through `${...}`-wrapped control-flow
 * blocks (for-stmt / if-stmt / switch-stmt / match-stmt) whose bodies contain
 * `lift <markup>...</>` expressions.
 *
 * Why a dedicated walker is needed (SPEC §26.1, Bug 17):
 *
 *   `scanClassesFromHtml(htmlBody)` only sees class names on STATIC HTML
 *   emitted at module-init time. Lift-expression bodies are emitted as JS
 *   `setAttribute("class", "...")` calls inside `_scrml_lift(() => {...})`
 *   factories — those strings never appear in the static HTML, so the
 *   HTML scanner misses them. Without this AST walker, Tailwind utility
 *   classes used inside `${ for ... lift <span class="text-red-500">...</> }`
 *   blocks emit no CSS rules. Silent broken styling.
 *
 * Per SPEC §26.1 the compiler MUST scan all class names in source markup —
 * "the compiler scans the source for class names and emits a CSS rule for
 * each Tailwind utility class it finds." Markup position is irrelevant to
 * that rule; iteration-body markup MUST be scanned.
 *
 * What's collected:
 *   1. `class="a b c"` static strings on any markup node (string-literal
 *      attribute values).
 *   2. The NAME portion of `class:NAME=expr` reactive directives — at
 *      runtime `_scrml_effect` calls `classList.toggle(NAME, ...)` so NAME
 *      is a real class added to the live DOM (§5.5.2).
 *
 * What's NOT collected (deferred — surface as anti-pattern):
 *   - Dynamic class strings via `class="${expr}"` interpolation. We can't
 *     statically know what string the expression evaluates to. Adopters
 *     wanting dynamic class names should use the `class:NAME=cond` form
 *     instead. (Existing W-TAILWIND-001 covers some failure modes.)
 *   - `class=@reactiveCell` whose runtime value is unknown.
 *
 * Recursion scope:
 *   - markup.children
 *   - logic node body (which carries lift-exprs, for-stmts, if-stmts,
 *     match-stmts, etc.)
 *   - for-stmt.body, while-stmt.body, switch-stmt.body, match-stmt.body
 *   - if-stmt.consequent + if-stmt.alternate
 *   - for-expr.body, if-expr.consequent/alternate, match-expr.body
 *   - lift-expr.expr.node when kind === "markup"
 *   - try-stmt body / catch / finally bodies (for completeness; try/catch
 *     is in stdlib migration backlog but if it appears, we still scan)
 *   - state-constructor-def body (constructor-bound markup for user-state
 *     elements)
 *   - function-decl.body (function bodies CAN contain lift-exprs)
 *   - engine-decl arms (state-machine arm bodies contain markup that
 *     emit-engine renders at runtime)
 *   - match-block arm bodies (the MARKUP block-form `<match>` — walkable
 *     markup lives in `bodyChildren` + `armBodyChildren`, NOT children/body)
 *   - each-block per-item body (the MARKUP block-form `<each>` — walkable
 *     markup lives in `bodyChildren`, NOT children/body)
 *   - component-decl bodies (component def bodies expand inline via CE
 *     before codegen; but if any unexpanded shape leaks through, we'd
 *     still scan)
 *
 * Anything not in that list is structurally inert with respect to class
 * names — we don't need to descend.
 */

interface LooseNode {
  kind?: string;
  attrs?: LooseAttr[];
  children?: LooseNode[];
  body?: LooseNode[];
  consequent?: LooseNode[];
  alternate?: LooseNode[] | null;
  expr?: LooseLiftTarget | string | unknown;
  // try-stmt clauses
  catchNode?: { body?: LooseNode[] };
  finallyNode?: { body?: LooseNode[] };
  // engine-decl arms (filtered structurally during walk)
  [key: string]: unknown;
}

interface LooseAttr {
  name?: string;
  value?: LooseAttrValue;
}

interface LooseAttrValue {
  kind?: string;
  value?: string;
  [key: string]: unknown;
}

interface LooseLiftTarget {
  kind?: string;
  node?: LooseNode;
  expr?: string;
}

/**
 * Collect every static class name reachable from `nodes` (top-level AST
 * nodes for one source file). The returned Set contains individual class
 * names (`"flex"`, `"bg-red-500"`, `"text-gray-700"`, etc.) — NOT the
 * full attribute value strings — so the caller can pass them directly
 * to `getAllUsedCSS([...names])`.
 *
 * Returns an empty Set on null/non-array input.
 */
export function collectClassNamesFromAst(nodes: unknown): Set<string> {
  const result = new Set<string>();
  if (!Array.isArray(nodes)) return result;
  walk(nodes as LooseNode[], result);
  return result;
}

function walk(list: LooseNode[], out: Set<string>): void {
  for (const node of list) {
    if (!node || typeof node !== "object") continue;
    visitNode(node, out);
  }
}

function visitNode(node: LooseNode, out: Set<string>): void {
  // Markup nodes are the source of all class strings.
  if (node.kind === "markup") {
    collectFromAttrs(node.attrs, out);
    if (Array.isArray(node.children)) walk(node.children, out);
    return;
  }

  // Logic nodes (`${...}` blocks) carry control-flow + lift-exprs in their
  // body. Recurse into the body uniformly — the children dispatch handles
  // every relevant shape (for/if/match/lift/etc.) by kind.
  if (node.kind === "logic") {
    if (Array.isArray(node.body)) walk(node.body, out);
    return;
  }

  // Control-flow statements + expressions whose bodies can contain lift
  // expressions or further nested control flow.
  if (node.kind === "for-stmt" || node.kind === "for-expr") {
    if (Array.isArray(node.body)) walk(node.body, out);
    return;
  }
  if (node.kind === "while-stmt") {
    if (Array.isArray(node.body)) walk(node.body, out);
    return;
  }
  if (node.kind === "if-stmt" || node.kind === "if-expr") {
    if (Array.isArray(node.consequent)) walk(node.consequent, out);
    if (Array.isArray(node.alternate)) walk(node.alternate, out);
    return;
  }
  if (node.kind === "switch-stmt" || node.kind === "match-stmt" ||
      node.kind === "match-expr") {
    if (Array.isArray(node.body)) walk(node.body, out);
    return;
  }
  if (node.kind === "try-stmt") {
    if (Array.isArray(node.body)) walk(node.body, out);
    if (node.catchNode && Array.isArray(node.catchNode.body)) walk(node.catchNode.body, out);
    if (node.finallyNode && Array.isArray(node.finallyNode.body)) walk(node.finallyNode.body, out);
    return;
  }

  // Lift expression — descend into the markup target. Inline markup is the
  // only target that carries class attributes (the `{kind: "expr"}` string
  // form is the deprecated path; emitting CSS for those strings would
  // require re-parsing the expr text and isn't load-bearing for canonical
  // sources today).
  if (node.kind === "lift-expr") {
    const target = node.expr as LooseLiftTarget | undefined;
    if (target && target.kind === "markup" && target.node) {
      visitNode(target.node, out);
    }
    return;
  }

  // Function declarations may contain lift-expressions in their body (e.g.
  // a function that builds a markup fragment with `lift <span class="...">`).
  if (node.kind === "function-decl") {
    if (Array.isArray(node.body)) walk(node.body, out);
    return;
  }

  // State constructor definitions carry markup in their body (constructor-
  // bound elements). Walk children + body uniformly.
  if (node.kind === "state-constructor-def" || node.kind === "state") {
    if (Array.isArray(node.children)) walk(node.children, out);
    if (Array.isArray(node.body)) walk(node.body, out);
    return;
  }

  // Engine declarations carry arm bodies. Each arm is a markup-bearing
  // body that emit-engine renders at runtime via innerHTML; classes
  // inside MUST be scanned.
  if (node.kind === "engine-decl") {
    // Engine-decl shape: `arms?: Array<{ body?: ASTNode[] }>` and/or
    // `children?` containing arm nodes. Walk both defensively.
    const arms = (node as Record<string, unknown>).arms;
    if (Array.isArray(arms)) {
      for (const arm of arms as LooseNode[]) {
        if (arm && Array.isArray(arm.body)) walk(arm.body, out);
        // Some shapes nest arms one level deeper.
        if (arm && Array.isArray(arm.children)) walk(arm.children, out);
      }
    }
    if (Array.isArray(node.children)) walk(node.children, out);
    if (Array.isArray(node.body)) walk(node.body, out);
    return;
  }

  // MARKUP block-form `<match>` (built ast-builder.js ~:13541). The walkable
  // arm-body markup does NOT live in `children`/`body`; it lives in
  // `bodyChildren` (a mirror of block.children — additive, engine-decl
  // precedent) and `armBodyChildren` (the per-arm bare bodies for the
  // g-formfor expansion passes, S177; `undefined` when no bare-body arms).
  // The generic fallback below never reaches those, so a utility class used
  // ONLY inside a `<match>` arm gets no CSS rule (silent unstyled render).
  // Recursion is uniform via `walk`, so a nested block-form inside an arm
  // (e.g. `<each>` in an arm body) falls out automatically.
  if (node.kind === "match-block") {
    const bodyChildren = (node as Record<string, unknown>).bodyChildren;
    if (Array.isArray(bodyChildren)) walk(bodyChildren as LooseNode[], out);
    const armBodyChildren = (node as Record<string, unknown>).armBodyChildren;
    if (Array.isArray(armBodyChildren)) walk(armBodyChildren as LooseNode[], out);
    return;
  }

  // MARKUP block-form `<each>` (built ast-builder.js ~:14142). The walkable
  // per-item body lives in `bodyChildren` (a full mirror of block.children,
  // INCLUDING the optional `<empty>` sub-element). `templateChildren` and
  // `emptyChild` are subsets/members of `bodyChildren`, so walking
  // `bodyChildren` alone reaches every class-bearing node. As with
  // `match-block`, the generic fallback never reaches `bodyChildren`.
  if (node.kind === "each-block") {
    const bodyChildren = (node as Record<string, unknown>).bodyChildren;
    if (Array.isArray(bodyChildren)) walk(bodyChildren as LooseNode[], out);
    return;
  }

  // Component declaration bodies — CE expands components inline before
  // codegen, so post-CE ASTs typically don't carry unexpanded component-
  // decl nodes in the render tree. Walk defensively in case any shape
  // leaks through (e.g. a non-instantiated component definition).
  if (node.kind === "component-decl") {
    if (Array.isArray(node.body)) walk(node.body, out);
    if (Array.isArray(node.children)) walk(node.children, out);
    return;
  }

  // Generic fallback: walk anything node-shaped that has children/body —
  // covers state-constructor variants, error-effect bodies, and any other
  // body-bearing shape we haven't enumerated. Class collection is purely
  // additive — false positives at this level just produce slightly
  // larger Sets, never wrong CSS.
  if (Array.isArray(node.children)) walk(node.children, out);
  if (Array.isArray(node.body)) walk(node.body, out);
}

function collectFromAttrs(attrs: LooseAttr[] | undefined, out: Set<string>): void {
  if (!Array.isArray(attrs)) return;
  for (const attr of attrs) {
    if (!attr || typeof attr.name !== "string") continue;
    const name = attr.name;

    // `class:NAME=expr` reactive directive — NAME is the class added at
    // runtime via classList.toggle (§5.5.2, Bug 13 fix).
    if (name.startsWith("class:")) {
      const cls = name.slice("class:".length);
      if (cls) out.add(cls);
      continue;
    }

    // Static `class="a b c"` — split on whitespace and add each.
    if (name === "class") {
      const val = attr.value;
      if (val && val.kind === "string-literal" && typeof val.value === "string") {
        for (const cls of val.value.split(/\s+/)) {
          if (cls) out.add(cls);
        }
      }
      // For non-string-literal `class=` values (variable-ref, expr,
      // call-ref), the runtime class string is unknown statically.
      // Skip — falls into the documented "dynamic class strings" edge
      // case (W-TAILWIND-001 covers some of these at a different
      // detection layer).
      continue;
    }
  }
}
