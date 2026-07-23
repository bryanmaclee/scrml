/**
 * Tag Canonicalizer — Stage 3.055 of the scrml compiler pipeline (TC).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS STAGE EXISTS
 * ---------------------------------------------------------------------------
 *
 * SPEC §4.3 (line 411): "The compiler resolves `<identifier>` against the
 * unified state-type registry (§15.X) at NR (Stage 3.05). **Casing is
 * irrelevant to resolution**; convention is PascalCase for components and
 * lowercase for HTML elements / built-in scrml lifecycle types."
 *
 * SPEC §4.2: "Classification is by the **registry**, never by whitespace …
 * `button` is a known HTML element name, so `<button>` resolves as an HTML
 * element (NR, **by registry** + naming convention)."
 *
 * NR (`name-resolver.ts`) already honours that: `resolveName` matches built-in
 * HTML elements CASE-INSENSITIVELY (§15.15.2 step 4), so `<Button>` is stamped
 * `resolvedKind: "html-builtin"` exactly like `<button>`.
 *
 * What was missing is the second half. The block splitter classifies
 * component-vs-element by capitalization alone (`isComponentName`, BS is a
 * pre-registry syntactic stage and cannot do better), so the node reaching
 * codegen still SPELLS itself `Button`. Every downstream element consumer
 * lowercases its own registry lookups but emits `node.tag` VERBATIM, so an
 * unregistered `<Button>` used to:
 *
 *   - escape `E-COMPONENT-035` (NR resolved it, so VP-2's residual-component
 *     test does not fire) — unlike `<Widget/>`, which is genuinely unresolved
 *     and is correctly rejected; and
 *   - reach the document as a literal `<Button>` tag, bypassing the attribute
 *     allowlist and the content model, and "working" only because an HTML
 *     parser is ASCII-case-insensitive.
 *
 * Neither normalized nor rejected — the exact gap `landmark-tag.ts` (S277)
 * flagged as "the deeper inconsistency" while fixing the `<MAIN>` landmark case
 * locally. This stage makes that fix general: after TC, a tag NR resolved to an
 * HTML element SPELLS that element, so every later stage — attribute
 * validation, the content model, SSR, emit — treats it as one with no
 * per-consumer casing rule.
 *
 * ---------------------------------------------------------------------------
 * WHY A SEPARATE STAGE RATHER THAN PART OF NR
 * ---------------------------------------------------------------------------
 *
 * SPEC §15.15.6 is explicit: "NR SHALL NOT mutate any existing AST field; it
 * adds only the two advisory fields." Rewriting `node.tag` inside NR would
 * violate that normative invariant. TC is therefore a distinct pass that CONSUMES
 * NR's authoritative stamp and owns the mutation. It runs immediately after NR
 * and before SYM/CE/TS/codegen, so no consumer ever sees a half-normalized AST.
 *
 * ---------------------------------------------------------------------------
 * THE RULE
 * ---------------------------------------------------------------------------
 *
 * For every `kind: "markup"` node NR visited:
 *
 *   1. If NR resolved the tag to a same-file declaration, an import, or a
 *      lifecycle type (`resolvedKind` is `user-component` / `user-state-type` /
 *      `scrml-lifecycle`) — LEAVE IT ALONE. Registration is what makes a tag a
 *      component, not capitalization, so a registered `Button` component still
 *      beats the HTML `button` element. This is the arm that proves TC keys on
 *      the REGISTRY and not on a name list; the live corpus case is
 *      `compiler/tests/integration/fixtures/a5/cross-file/app.scrml`, whose
 *      `<Header/>` is an IMPORTED component sharing a name with `<header>`.
 *   2. Else, if NR resolved it to `html-builtin`, rewrite the tag to the
 *      canonical element spelling and clear the legacy `isComponent` flag.
 *   3. Else (`unknown`) — LEAVE IT ALONE. `<Widget/>` keeps firing
 *      `E-COMPONENT-035` at VP-2, which is the correct "rejected" outcome.
 *
 * The post-condition is a strict equivalence, and it is the property to test
 * against: after TC, `<Button>` compiles to exactly what `<button>` compiles to.
 * TC never invents a classification of its own — it only makes the SPELLING
 * agree with the classification NR already made.
 *
 * SCOPE NOTE (deliberate, measured). Arm 2 keys on `resolvedKind`, so its reach
 * is exactly NR's §15.15.2 step 4: the curated `html-elements.js` REGISTRY (46
 * render elements). Element names outside that registry — `pre`, `code`,
 * `dialog`, `details`, the SVG/MathML namespaces — resolve to `unknown` at NR
 * even in their lowercase spelling, so a capitalized `<Pre>` lands in arm 3 and
 * is REJECTED rather than normalized. That is the safe half of the bug (loud,
 * not silent), and widening it means widening NR's step-4 registry, which is a
 * §15.15.2 change and not this stage's to make.
 */

import { canonicalElementName } from "./html-elements.js";
import { SCRML_NON_ELEMENT_TAGS } from "./name-resolver.ts";
import type { ASTNode, FileAST } from "./types/ast.ts";

export interface TCRewrite {
  /** The tag as the author spelled it. */
  from: string;
  /** The canonical element spelling it was rewritten to. */
  to: string;
  line: number | null;
  col: number | null;
}

export interface TCResult {
  filePath: string;
  rewrites: TCRewrite[];
}

/**
 * Canonicalize one markup node in place. Returns the rewrite that was applied,
 * or `null` when the node was left untouched.
 */
function canonicalizeNode(node: any): TCRewrite | null {
  const tag = node.tag;
  if (typeof tag !== "string" || tag.length === 0) return null;

  // Only nodes NR actually visited carry an authoritative stamp. An unstamped
  // node (a shape that bypassed NR — e.g. a component body CE re-parses later)
  // has no registry verdict to act on, and guessing from spelling is the very
  // thing this stage exists to stop doing.
  if (node.resolvedKind !== "html-builtin") return null;

  const canonical = canonicalElementName(tag);
  if (canonical === null || canonical === tag) return null;

  // Defensive: never rewrite into a scrml structural / directive tag name.
  // Those are parsed by dedicated upstream machinery keyed on the tag string,
  // so synthesising one here would hand a later stage a node that never went
  // through that machinery. (Empirically the two sets are disjoint today; the
  // guard is here so adding a structural element cannot silently break it.)
  if (SCRML_NON_ELEMENT_TAGS.has(canonical.toLowerCase())) return null;

  node.tag = canonical;
  // The legacy `isComponent` boolean (SPEC §15.15.6) is BS's syntactic
  // uppercase-first-char guess. It is no longer the authoritative routing
  // signal, but several backcompat read-paths still consult it when NR's stamp
  // is absent, so keep it consistent with the canonical spelling.
  if (node.isComponent === true) node.isComponent = false;

  return {
    from: tag,
    to: canonical,
    line: node.span?.line ?? null,
    col: node.span?.col ?? null,
  };
}

/**
 * Walk every reachable AST node. Mirrors NR's reach by traversing every
 * array-valued and node-valued child slot, so markup nested inside lift
 * expressions, engine bodies, match arms and component bodies is covered.
 */
function walk(node: unknown, seen: Set<object>, out: TCRewrite[]): void {
  if (!node || typeof node !== "object") return;
  if (seen.has(node as object)) return;
  seen.add(node as object);

  if (Array.isArray(node)) {
    for (const child of node) walk(child, seen, out);
    return;
  }

  const anyN = node as any;
  if (anyN.kind === "markup") {
    const rewrite = canonicalizeNode(anyN);
    if (rewrite) out.push(rewrite);
  }

  for (const key of Object.keys(anyN)) {
    // `_scope` / `_record` are SYM back-references and `span` is a leaf; neither
    // can contain markup, and following back-references risks re-entry.
    if (key === "span" || key === "_scope" || key === "_record") continue;
    walk(anyN[key], seen, out);
  }
}

/** Run TC over one file's AST. Mutates the AST in place. */
export function runTC(filePath: string, ast: FileAST): TCResult {
  const rewrites: TCRewrite[] = [];
  const seen = new Set<object>();
  walk(ast.nodes as ASTNode[] | undefined, seen, rewrites);
  walk((ast as any).components, seen, rewrites);
  return { filePath, rewrites };
}

/** Run TC over a batch of TAB results. */
export function runTCBatch(
  files: Array<{ filePath: string; ast: FileAST }>,
): TCResult[] {
  return files.map((f) => runTC(f.filePath, f.ast));
}
