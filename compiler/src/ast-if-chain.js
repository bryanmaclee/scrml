/**
 * ast-if-chain.js — the ONE place that knows where a §17.1.1 `if-chain` node
 * keeps its child markup.
 *
 * WHY THIS MODULE EXISTS. `collapseIfChains` (ast-builder.js) rewrites an
 * `if=`/`else-if=`/`else` chain that HAS an else-arm into a new node:
 *
 *     { kind: "if-chain", branches: [{ condition, element }, …], elseBranch }
 *
 * The branch bodies therefore live under `branches[].element` + `elseBranch` —
 * and under NONE of the container keys the compiler's many hand-rolled walks
 * recurse into (`children` / `body` / `bodyChildren` / `nodes` / `arms` /
 * `templateChildren`). `branches` itself is an array of `{condition, element}`
 * RECORDS, not nodes, so even a walk that happens to list `branches` among its
 * generic keys silently fails to reach `element`.
 *
 * A lone `if=` (no else) is passed through as plain markup and never hits this,
 * which is exactly why "add an `<div else>` sibling" was the discriminator that
 * turned a working `<each>` into zero renderers at exit 0
 * (g-each-in-if-else-chain-emits-zero-renderers, HIGH).
 *
 * That bug was ONE fact — "an if-chain's children are here" — copied into six
 * walks, and a seventh walk (`lint-w-each-key.js`) that did not get the memo
 * silently stopped lint-ing every `<each>` under an if/else chain. Rather than
 * grow the copy count, every walk now asks THIS function. The recursion context
 * (an enclosing iter var, a nested-scope flag, an early-exit) stays with each
 * caller, because that part genuinely differs; only the child SHAPE is shared.
 *
 * ⚠ If a future §17.1.1 amendment adds another branch-carrying field, add it
 * HERE and every consumer inherits it. Grep `ifChainChildNodes` for the list.
 *
 * @module ast-if-chain
 */

/**
 * Enumerate the child markup nodes of a §17.1.1 `if-chain` node, in source
 * order: every branch's `element`, then the `elseBranch`.
 *
 * Returns an EMPTY array for any node that is not an `if-chain`, so a caller
 * may call it unconditionally if that reads better than a `kind` test.
 *
 * @param {any} node — any AST node (or non-node; falsy input is tolerated)
 * @returns {any[]} the branch bodies, never null, never containing falsy entries
 */
export function ifChainChildNodes(node) {
  if (!node || typeof node !== "object" || node.kind !== "if-chain") return [];
  const out = [];
  for (const branch of node.branches ?? []) {
    if (branch && branch.element) out.push(branch.element);
  }
  if (node.elseBranch) out.push(node.elseBranch);
  return out;
}
