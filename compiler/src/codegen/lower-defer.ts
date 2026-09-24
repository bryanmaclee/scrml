/**
 * `defer` lowering — SPEC §19.16.6 (S430 P3 stage 1).
 *
 * A `defer` statement registers its deferred body against the ENCLOSING BLOCK;
 * the body runs exactly once on every exit from that block, LIFO (§19.16.2).
 * The lowering is a compiler-emitted host `try { … } finally { … }`: for a
 * statement list
 *
 *     [ a, defer D1, b, defer D2, c ]
 *
 * the statements AFTER each `defer` become the `try` body and the deferred body
 * becomes the `finally` body, nesting for each subsequent `defer`:
 *
 *     a
 *     try { b; try { c } finally { D2 } } finally { D1 }
 *
 * which yields LIFO order, "not reached => not registered", and run-on-every-
 * exit (`return` / `break` / `continue` / `fail` / `?` / host throw) by
 * construction — all of those are JS exits of the `try` block.
 *
 * The lowered node is a `try-stmt` carrying `deferLowered: true` (NOT a
 * scrml-source try — E-TRY-NOT-IN-SCRML is a parse-time rule and never sees
 * it). Reusing the `try-stmt` SHAPE (`body` + `finallyNode.body`) means every
 * codegen walker that already understands try-stmt (reactive-deps, usage
 * analysis, the scheduler's control-flow fence, the auto-await injector) sees
 * into both halves with no per-walker change. `emitLogicNode` routes the flag to
 * the opts-threading `emitDeferScope` emitter (emit-control-flow.ts).
 *
 * ⚑ BODY-SPLIT (CPS, §19.9.9 / §19.16.5): the TOP-LEVEL statement list of a
 * CPS-split function is NOT restructured here. Route inference computed the
 * split as INDICES into that exact list (`cpsSplit.serverStmtIndices`,
 * `serverBatches[].indices`, `topoOrder`), and both the server stubs and the
 * client wrapper address statements by those indices. The client wrappers
 * (emit-functions.ts) lower a top-level `defer-stmt` themselves, by opening the
 * `try` at the defer's position in their SEQUENTIAL walk and closing every open
 * `finally` after the walk — i.e. after the LAST batch's `await` and the last
 * client continuation. Nested lists inside a split function are lowered here as
 * usual (the split never addresses them). A server-tier deferred body in a
 * split function is rejected upstream (E-DEFER-SERVER-IN-SPLIT), so a server
 * batch never contains a `defer-stmt`.
 *
 * The pass mutates statement arrays IN PLACE (splice) so any other holder of
 * the same array sees the lowered list. It is idempotent: a lowered list no
 * longer contains a `defer-stmt`.
 *
 * @module lower-defer
 */

type Node = Record<string, unknown> & { kind?: string; span?: unknown };

/** Is this the compiler-lowered form of a `defer` (not a source try)? */
export function isDeferLoweredTry(node: unknown): boolean {
  return !!node && typeof node === "object" &&
    (node as Node).kind === "try-stmt" && (node as Node).deferLowered === true;
}

/**
 * Restructure one statement list. Returns the new list contents (the caller
 * splices them into the original array).
 */
export function lowerDeferList(list: unknown[]): unknown[] {
  const idx = list.findIndex((s) => !!s && typeof s === "object" && (s as Node).kind === "defer-stmt");
  if (idx < 0) return list;
  const d = list[idx] as Node;
  const rest = lowerDeferList(list.slice(idx + 1));
  const deferredBody = Array.isArray(d.body) ? (d.body as unknown[]) : [];
  const tryNode: Node = {
    id: d.id,
    kind: "try-stmt",
    header: "",
    body: rest,
    finallyNode: { header: "", body: deferredBody },
    deferLowered: true,
    span: d.span,
  };
  return [...list.slice(0, idx), tryNode];
}

/**
 * Lower every `defer-stmt` reachable from `root`, EXCEPT the top-level body of
 * the function nodes in `skipTopLevelOf` (the CPS-split functions — see the
 * module docstring). Nested lists inside a skipped body are still lowered.
 */
export function lowerDefers(root: unknown, skipTopLevelOf: Set<unknown>): void {
  const seen = new WeakSet<object>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (seen.has(node as object)) return;
    seen.add(node as object);
    if (Array.isArray(node)) {
      for (const c of node) visit(c);
      if (node.some((s) => !!s && typeof s === "object" && (s as Node).kind === "defer-stmt")) {
        const lowered = lowerDeferList(node);
        node.splice(0, node.length, ...lowered);
      }
      return;
    }
    const n = node as Node;
    for (const key of Object.keys(n)) {
      if (key === "span" || key === "parent") continue;
      const v = n[key];
      if (key === "body" && Array.isArray(v) && skipTopLevelOf.has(n)) {
        // Split-function top level: descend into each statement, but do NOT
        // restructure the list itself (its indices are the CPS split's contract).
        seen.add(v);
        for (const c of v) visit(c);
        continue;
      }
      visit(v);
    }
  };
  visit(root);
}

/** Does this statement list contain a (not-yet-lowered) `defer-stmt`? */
export function listHasDefer(list: unknown): boolean {
  return Array.isArray(list) &&
    list.some((s) => !!s && typeof s === "object" && (s as Node).kind === "defer-stmt");
}
