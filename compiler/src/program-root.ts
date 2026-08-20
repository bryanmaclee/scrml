/**
 * @module program-root
 *
 * SPEC §4.12 — the single source of truth for **"is this `<program>` element the
 * document root, or is it a nested execution context?"**
 *
 * ## The question this module answers, and the two wrong answers it replaces
 *
 * §4.12.2 normative:
 *
 * > The top-level `<program>` MUST NOT have a `name=` attribute (it is the
 * > implicit root). […] The compiler SHALL NOT treat a top-level
 * > `<program name=>` as a nested execution context: the extraction pre-pass of
 * > §4.12.8 applies to nested `<program>` elements only.
 *
 * §4.12.8 normative, the other side of the same coin:
 *
 * > The compiler SHALL extract each nested `<program>` as an independent
 * > compilation unit before running any analysis pass on its contents.
 *
 * So every `<program>` element in a file must be classified TOP-LEVEL (never
 * extracted, `name=` inert) or NESTED (always extracted, per its §4.12.3 kind).
 * The classification must be TOTAL — a `<program>` that is neither gets no
 * extraction AND no diagnostic, which is precisely the hole this module closes.
 *
 * Two wrong answers have shipped:
 *
 * 1. **`name=` presence.** "A `<program>` with a `name=` is a worker." Corrected
 *    S356 by `nested-program-kind.ts` — `name=` selects nothing; the §4.12.3
 *    ATTRIBUTE COMBINATION selects the execution context.
 *
 * 2. **`<program>`-ancestor depth.** "A `<program>` with ≥1 `<program>` ancestor
 *    is nested." This module corrects that one. The counter incremented only
 *    when descending THROUGH a `<program>`, so in a file whose root element is
 *    NOT a `<program>` — a `<page>`-rooted route file, the documented
 *    multi-page shape — a nested `<program name="w">` sat at depth 0, was never
 *    claimed, and got no extraction, no bundle, no `new Worker(...)` **and no
 *    diagnostic**, while `emit-client` still emitted the `<#w>.send()` call
 *    site. Measured: `ReferenceError: _scrml_worker_w is not defined` on first
 *    click, from a build that exited 0 with zero diagnostics.
 *
 *    Depth is also walk-RELATIVE: it must be re-derived correctly at each of the
 *    six sites that tracked it, and it was not.
 *
 * ## The predicate: membership of the file's ROOT nodes array
 *
 * A `<program>` is TOP-LEVEL iff it is a member of the file's root nodes array.
 * Everything else — including a `<program>` whose only markup ancestor is a
 * `<page>` — is NESTED.
 *
 * Why membership rather than seeding the depth counter to 1 for `<page>`-rooted
 * files (the other option on the table):
 *
 * - **Depth-seeding is not total.** It fixes the `<page>`-rooted file, but a
 *   SECOND top-level `<program name="w">` sibling in a file that DOES have a
 *   root `<program>` is still at depth 0, so it stays unclassified. Membership
 *   classifies it (top-level ⇒ not extracted ⇒ `W-PROGRAM-TOP-LEVEL-NAME`),
 *   which is also what §4.12.2 says literally: the `name=` is inert because
 *   there is no enclosing `<program>` to reference it by name.
 * - **It matches the convention already in the tree.** Ten sites already locate
 *   the root with a top-level-array `.find` (`hasProgramRoot` in
 *   `ast-builder.js`, `findTopLevelProgramNode` in `tool-program.ts`,
 *   `findRootProgram` in `reachability/entry-points.ts`, `entryProgramNode`,
 *   …). Introducing a SECOND, differently-shaped notion of "root" is exactly
 *   the drift this arc exists to stop.
 * - **It is walk-invariant.** Node identity does not depend on the path taken to
 *   reach the node, so six consumers cannot re-derive it six ways.
 *
 * ## Consumers
 *
 * | consumer | decides |
 * |---|---|
 * | `codegen/index.ts` `extractWorkerPrograms` | splice / register worker / refuse |
 * | `codegen/index.ts` `detectNestedDocAttrs` | `W-PROGRAM-TITLE-NESTED` |
 * | `codegen/index.ts` `detectTopLevelProgramName` | `W-PROGRAM-TOP-LEVEL-NAME` |
 * | `codegen/emit-html.ts` | skip an extracted nested subtree |
 * | `symbol-table.ts` `walkChannelPlacement` | `E-CHANNEL-INSIDE-NESTED-PROGRAM`, `<page>` scope reset |
 * | `route-inference.ts` `collectWorkerBodyFunctionIds` | `E-ROUTE-001` suppression |
 * | `codegen/emit-theme-reset.ts` | which `<program>` owns `<theme>` reset |
 *
 * Pairs with `nested-program-kind.ts`: this module answers WHICH `<program>`
 * elements are nested; that one answers WHAT KIND each nested one is. Neither
 * question is answerable from `name=`.
 */

/** A loosely-typed AST node. */
type ASTNodeLike = Record<string, unknown>;

/** TRUE for a `<program>` markup element, in any of the shapes the builders emit. */
export function isProgramMarkup(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const n = node as ASTNodeLike;
  return n.kind === "markup" && (n.tag ?? "") === "program";
}

/**
 * The set of TOP-LEVEL `<program>` elements in `rootNodes` — the members of the
 * file's root nodes array whose tag is `program`.
 *
 * Identity-keyed, so callers test membership with `.has(node)` rather than
 * re-deriving a position or a depth.
 *
 * Pass the FILE ROOT array. Passing a subtree (e.g. a match-arm body being
 * lowered as nested markup) would wrongly promote that subtree's `<program>`
 * children to top-level; such callers pass an empty set instead.
 */
export function collectTopLevelPrograms(rootNodes: unknown): Set<object> {
  const out = new Set<object>();
  if (!Array.isArray(rootNodes)) return out;
  for (const n of rootNodes) {
    if (isProgramMarkup(n)) out.add(n as object);
  }
  return out;
}

/**
 * The DOCUMENT-ROOT `<program>` — the FIRST top-level `<program>`, or `null` for
 * a file that has none (a `<page>`-rooted route file, a §21.5 library file).
 *
 * "First" matches every existing root lookup in the compiler. A second top-level
 * `<program>` is still TOP-LEVEL (so it is never extracted), but it is not the
 * document root: it contributes no `<head>` metadata, no `auth=` config, and no
 * `<theme>` reset scope.
 */
export function findDocumentRootProgram(rootNodes: unknown): object | null {
  if (!Array.isArray(rootNodes)) return null;
  for (const n of rootNodes) {
    if (isProgramMarkup(n)) return n as object;
  }
  return null;
}

/**
 * TRUE when `node` is a `<program>` element that is NOT top-level — i.e. a
 * NESTED `<program>` in the §4.12 sense, the population §4.12.8's extraction
 * requirement reaches.
 *
 * A `<program>` whose nearest markup ancestor is a `<page>` IS nested: §4.12.1
 * makes a nested `<program>` a fresh compilation unit regardless of what encloses
 * it, and the S353 ruling banked in §34 (`E-CHANNEL-INSIDE-NESTED-PROGRAM`)
 * already treats `<page>` → `<program>` → `<channel>` as the nested case.
 */
export function isNestedProgram(node: unknown, topLevelPrograms: Set<object>): boolean {
  if (!isProgramMarkup(node)) return false;
  return !topLevelPrograms.has(node as object);
}

/**
 * TRUE when `node` is a TOP-LEVEL `<program>` — a member of the file's root
 * nodes array. `name=` on one of these is INERT (§4.12.2: there is no enclosing
 * `<program>` to reference it by name), and the §4.12.8 extraction pre-pass
 * SHALL NOT reach it.
 */
export function isTopLevelProgram(node: unknown, topLevelPrograms: Set<object>): boolean {
  if (!isProgramMarkup(node)) return false;
  return topLevelPrograms.has(node as object);
}

/** The file's root nodes array, tolerating the `fileAST.nodes` / `fileAST.ast.nodes` shapes. */
export function rootNodesOf(fileAST: unknown): unknown[] {
  if (!fileAST || typeof fileAST !== "object") return [];
  const f = fileAST as ASTNodeLike;
  if (Array.isArray(f.nodes)) return f.nodes;
  const inner = f.ast as ASTNodeLike | undefined;
  if (inner && Array.isArray(inner.nodes)) return inner.nodes;
  return [];
}
