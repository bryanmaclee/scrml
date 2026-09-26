/**
 * VP-2 — Post-CE Invariant Check
 *
 * Walks the AST after Component Expansion (CE) and emits a hard error
 * when any markup node still resolves to `user-component` (per NR's
 * `resolvedKind`) — or, more importantly, when an unresolved tag with
 * an uppercase-first-char name (the F-COMPONENT-001 pattern) survives
 * CE without being expanded. Closes the silent-failure window where
 * the CE stage left a phantom component reference in the tree and
 * downstream codegen happily emitted `document.createElement("UserBadge")`.
 *
 * Emits: E-COMPONENT-035 — residual component reference after CE.
 *
 * The architectural fix (cross-file CE actually working in every shape
 * the silent path currently covers) is W2 territory. This pass closes
 * the SILENT-EMISSION window now: if CE didn't resolve the reference,
 * compilation fails loudly with a precise error code at the call site.
 *
 * Per PIPELINE.md Stage 3.2 (deep-dive §11.3 D3): a residual markup node
 * resolved to `user-component` SHALL be a downstream error. This pass IS
 * that downstream error — VP-2 reconciles the line 614 vs 639 tension.
 *
 * P3-FOLLOW: invariant flipped from `isComponent === true` to NR's
 * `resolvedKind` field plus an uppercase-first-char syntactic check (the
 * latter mirrors BS's isComponentName predicate without reading the legacy
 * `isComponent` boolean). NR is authoritative for routing; the syntactic
 * heuristic survives because BS's classification of an unknown tag as a
 * "component reference" is semantically distinct from NR's "user-component"
 * resolution kind — the post-CE invariant covers both.
 *
 * Cross-reference:
 *   - SPEC §15 (component definition) — post-CE invariant amendment.
 *   - PIPELINE.md Stage 3.2 — fail-fast at CE exit.
 *   - F-COMPONENT-001 — closed silent-failure window after this pass lands.
 *   - examples/22-multifile/ — currently silent-passes; will fail with
 *     E-COMPONENT-035 after this pass is wired in.
 */

import type { Span, FileAST } from "../types/ast.ts";
import { walkFileAst, walkNode } from "./ast-walk.ts";

// ---------------------------------------------------------------------------
// Diagnostic shape — matches CEError shape used by the existing component
// expander, so api.js's collectErrors picks it up unchanged.
// ---------------------------------------------------------------------------

export interface PostCEInvariantError {
  code: string;
  message: string;
  span: Span;
  severity: "error";
}

// ---------------------------------------------------------------------------
// g-block-match-in-lift — unrecognized block-`<match>` in a lift context
// ---------------------------------------------------------------------------

/**
 * Detect a block `<match for=Type on=expr>` that was parsed by the logic-context
 * inline-markup path (a `${ ... lift ... }` loop body) rather than the BS-layer
 * S107 match-block recognition (`ast-builder.js` `block.name === "match"`). The
 * recognized form builds a `kind:"match-block"` node; the unrecognized form lands
 * as a RAW `kind:"markup" tag:"match"` node whose variant arms (`<Open>`/`<Closed>`)
 * are uppercase-tag markup children that survive CE unresolved and would otherwise
 * fire a misleading E-COMPONENT-035 cascade pointing at a phantom cross-file
 * component-import problem.
 *
 * Per the S212 user ruling ("(b) targeted diagnostic, steer to `<each>`"; option
 * (a) support-the-form REJECTED — limit-primitives, `<each>` is canonical per S130
 * HU-1), emit ONE targeted `E-MATCH-BLOCK-IN-LIFT` per unrecognized `<match>` and
 * collect its arm nodes into `suppressed` so the E-COMPONENT-035 walk skips them
 * (this shape's misleading cascade is REPLACED, not supplemented). SPEC §34.
 */
function collectUnrecognizedMatchBlocks(
  root: unknown,
  errors: PostCEInvariantError[],
  suppressed: Set<object>,
  filePath: string,
): void {
  const seen = new Set<object>();
  function visit(node: unknown, insideMatch: boolean): void {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const c of node) visit(c, insideMatch);
      return;
    }
    const n = node as {
      kind?: string;
      tag?: string;
      attrs?: Array<{ name?: string; value?: { name?: string; exprNode?: { name?: string } } }>;
      span?: Span;
    };
    const tag = n.tag ?? "";
    let nowInside = insideMatch;
    // The recognized block-form is `kind:"match-block"`; a residual
    // `kind:"markup" tag:"match"` carrying a `for=` attr is the unrecognized form.
    const forAttr = Array.isArray(n.attrs)
      ? n.attrs.find((a) => a && a.name === "for")
      : undefined;
    if (n.kind === "markup" && tag === "match" && forAttr) {
      const forType = forAttr.value?.name ?? forAttr.value?.exprNode?.name ?? "Type";
      const span = n.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
      errors.push({
        code: "E-MATCH-BLOCK-IN-LIFT",
        message:
          `E-MATCH-BLOCK-IN-LIFT: A block \`<match for=${forType} ...>\` is not supported inside a ` +
          `\`\${ ... lift ... }\` logic loop — its variant arms are not recognized as match arms in this ` +
          `context (they would otherwise surface a misleading "unresolved component" error). The supported ` +
          `per-item form is the Tier-1 \`<each>\` block: move the \`<match>\` into an ` +
          `\`<each in=@collection as item> ... <match for=${forType} on=item> ... </match> ... </each>\` body ` +
          `— the same block \`<match>\` compiles there. See SPEC §17.7 (\`<each>\`) and §18.0.1 (block-form \`<match>\`).`,
        span,
        severity: "error",
      });
      nowInside = true;
    }
    // While inside an unrecognized `<match>`, every uppercase-tag markup descendant
    // is an arm (or arm content) whose E-COMPONENT-035 would be the misleading cascade.
    if (
      insideMatch &&
      n.kind === "markup" &&
      tag.length > 0 &&
      tag.charCodeAt(0) >= 65 &&
      tag.charCodeAt(0) <= 90
    ) {
      suppressed.add(node);
    }
    for (const k of Object.keys(n)) {
      const v = (n as Record<string, unknown>)[k];
      if (v && typeof v === "object") visit(v, nowInside);
    }
  }
  visit(root, false);
}

// ---------------------------------------------------------------------------
// Public entry — single file
// ---------------------------------------------------------------------------

/**
 * Run VP-2 over a single file's AST. Returns the list of residual-component
 * errors found. Does NOT mutate the AST.
 */
export function runPostCEInvariantFile(file: {
  filePath: string;
  ast: FileAST | null | undefined;
}): PostCEInvariantError[] {
  const errors: PostCEInvariantError[] = [];
  const ast = file.ast;
  if (!ast) return errors;

  // g-block-match-in-lift (S213, user ruling S212): pre-scan for unrecognized
  // block-`<match>` nodes (lift-context), emit E-MATCH-BLOCK-IN-LIFT, and collect
  // their arm nodes into `suppressed` so the E-COMPONENT-035 walk below skips the
  // misleading cascade. See collectUnrecognizedMatchBlocks above.
  const suppressed = new Set<object>();
  collectUnrecognizedMatchBlocks(ast, errors, suppressed, file.filePath);

  // S429 — engine state-child bodies. `walkFileAst` (and NR) never descend an
  // `engine-decl`'s `bodyChildren`, so an unresolved uppercase tag written INSIDE
  // a state-child body (`<On><Foo>…</></>`) reached codegen as a phantom
  // `<foo>` element at exit 0 — the exact silent window this pass exists to
  // close. Until S429 the engine state-child parser also mis-read such a tag as
  // a SIBLING state-child when it sat inside a lowercase element and closed with
  // `</>` (a false E-ENGINE-STATE-CHILD-MISSING); fixing that parse must not
  // turn the shape silent, so the invariant now covers these bodies too.
  // The state-child WRAPPERS (the direct uppercase children of the engine body)
  // are variants, not component references, and are skipped; their contents are
  // walked with the same visitor, and a nested engine found there is handled the
  // same way. (Match-block arm bodies stay out of scope here exactly as they are
  // at file level — `walkNode` does not descend a `match-block`.)
  const engineQueue: object[] = [];
  const engineSeen = new Set<object>();

  const visitor = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if ((node as { kind?: string }).kind === "engine-decl" && !engineSeen.has(node)) {
      engineSeen.add(node);
      engineQueue.push(node);
    }
    checkResidual(node);
  };

  walkFileAst(ast, visitor);
  while (engineQueue.length > 0) {
    const decl = engineQueue.shift() as { bodyChildren?: unknown[] };
    for (const child of decl.bodyChildren ?? []) {
      const c = child as { kind?: string; tag?: string; children?: unknown[] } | null;
      if (!c || typeof c !== "object") continue;
      const t = c.tag ?? "";
      const isStateChildWrapper =
        c.kind === "markup" && t.length > 0 && t.charCodeAt(0) >= 65 && t.charCodeAt(0) <= 90;
      if (isStateChildWrapper) {
        for (const inner of c.children ?? []) walkNode(inner, visitor);
      } else {
        walkNode(c, visitor);
      }
    }
  }

  return errors;

  function checkResidual(node: unknown): void {
    if (!node || typeof node !== "object") return;
    const n = node as {
      kind?: string;
      tag?: string;
      resolvedKind?: string;
      resolvedCategory?: string;
      span?: Span;
    };
    if (n.kind !== "markup") return;
    // Suppressed: a variant arm of an unrecognized block-`<match>` in a lift
    // context — E-MATCH-BLOCK-IN-LIFT already fired for the enclosing `<match>`
    // (g-block-match-in-lift). Skip the misleading E-COMPONENT-035 for it.
    if (suppressed.has(node)) return;
    // P3-FOLLOW: route on NR's resolvedKind / resolvedCategory (authoritative).
    // VP-2 fires on:
    //   (a) resolvedKind === "user-component" — a known component CE should
    //       have expanded but didn't (cross-file expansion failure), OR
    //   (b) resolvedKind === "unknown" with an uppercase-first-char tag —
    //       the F-COMPONENT-001 pattern: BS classified the tag as a component
    //       reference (via the uppercase syntactic heuristic) but NR could not
    //       resolve it (no same-file decl, no import). This is the silent
    //       phantom-DOM emission case VP-2 was created to catch.
    //   (c) S95 Bug 5: resolvedKind absent (NR never visited this node) AND
    //       uppercase-first tag. Defense-in-depth for AST shapes that bypass
    //       NR — specifically, nodes inside a component-def body that CE re-
    //       parses via parseComponentBody (BS+TAB only, no NR). These nodes
    //       reach VP-2 with no resolvedKind stamp; the uppercase heuristic
    //       (BS's syntactic component-name predicate) is the only signal
    //       available. Without this branch the residual TaskCard inside
    //       Column's expanded body slipped past VP-2 silently and reached
    //       codegen as `createElement("TaskCard")`. The right architectural
    //       fix is Bug 5a (CE must recurse into expanded user-component
    //       bodies); this branch is the defensive backstop, mirroring the
    //       (b) clause's tag-only routing.
    // The uppercase-first-char heuristic mirrors BS's isComponentName predicate
    // (tag charCode in 'A'..'Z') without reading the legacy isComponent boolean.
    const tag = n.tag ?? "";
    const looksLikeComponent =
      tag.length > 0 && tag.charCodeAt(0) >= 65 && tag.charCodeAt(0) <= 90;
    const isResidualComponent =
      n.resolvedKind === "user-component" ||
      (n.resolvedKind === "unknown" && looksLikeComponent) ||
      (n.resolvedKind == null && looksLikeComponent);
    if (!isResidualComponent) return;

    const tagDisplay = tag.length > 0 ? tag : "<unknown>";
    const span = n.span ?? { file: file.filePath, start: 0, end: 0, line: 1, col: 1 };
    errors.push({
      code: "E-COMPONENT-035",
      message:
        `E-COMPONENT-035: Component \`${tagDisplay}\` survived component expansion (CE) but was not resolved. ` +
        `This is a post-CE invariant violation: every markup node resolved to user-component (or unresolved with an uppercase tag) MUST be ` +
        `expanded into HTML markup or rejected with E-COMPONENT-020 at CE time. The residual reference ` +
        `would otherwise be silently emitted as \`document.createElement("${tagDisplay}")\`, producing a ` +
        `phantom DOM element with no content. ` +
        `Likely cause: cross-file component import is not yet supported in this consumption shape ` +
        `(see F-COMPONENT-001 deep-dive). ` +
        `Workaround: wrap the component call in an HTML element inside a \`lift\` expression, e.g. ` +
        `\`lift <div><${tagDisplay}/></div>\`.`,
      span,
      severity: "error",
    });
  }
}

/**
 * Run VP-2 over a multi-file CE output set. Returns the merged error list.
 */
export function runPostCEInvariant(input: {
  files: Array<{ filePath: string; ast: FileAST | null | undefined }>;
}): { errors: PostCEInvariantError[] } {
  const all: PostCEInvariantError[] = [];
  for (const f of input.files) {
    all.push(...runPostCEInvariantFile(f));
  }
  return { errors: all };
}
